const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const dns = require('dns').promises;
const User = require('../models/User');

const OTP_VALIDITY_MS = 10 * 60 * 1000;

// DNS validation cache (in-memory) - expires after 1 hour
const dnsCache = new Map();
const DNS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

function getCachedDnsResult(domain) {
  const cached = dnsCache.get(domain);
  if (cached && Date.now() - cached.timestamp < DNS_CACHE_TTL) {
    return cached.result;
  }
  dnsCache.delete(domain);
  return null;
}

function setCachedDnsResult(domain, result) {
  dnsCache.set(domain, { result, timestamp: Date.now() });
}

function isValidEmailFormat(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value || value.length > 254) return false;

  const parts = value.split('@');
  if (parts.length !== 2) return false;

  const [localPart, domainPart] = parts;
  if (!localPart || !domainPart) return false;
  if (localPart.length > 64) return false;
  if (localPart.startsWith('.') || localPart.endsWith('.')) return false;
  if (domainPart.startsWith('.') || domainPart.endsWith('.')) return false;
  if (value.includes('..')) return false;

  const labels = domainPart.split('.');
  if (labels.length < 2) return false;
  if (!labels.every(label => /^[a-z0-9-]+$/i.test(label) && !label.startsWith('-') && !label.endsWith('-'))) {
    return false;
  }

  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,}$/i.test(tld)) return false;

  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+$/i.test(value);
}

async function hasDeliverableEmailDomain(email) {
  const value = String(email || '').trim().toLowerCase();
  const atIndex = value.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === value.length - 1) return false;

  const domain = value.slice(atIndex + 1);
  
  // Check cache first
  const cachedResult = getCachedDnsResult(domain);
  if (cachedResult !== null) {
    return cachedResult;
  }

  // Set a 3-second timeout for DNS lookups to avoid blocking signup
  const DNS_TIMEOUT = 3000;
  let dnsUnavailable = false;

  const markDnsAvailability = (error) => {
    const code = String(error?.code || '').toUpperCase();
    if (code === 'ECONNREFUSED' || code === 'ETIMEOUT' || code === 'EAI_AGAIN' || code === 'ENOSYS') {
      dnsUnavailable = true;
    }
  };

  // Run DNS lookups in parallel instead of sequentially
  const results = await Promise.all([
    // Try MX records (highest priority for email)
    new Promise(resolve => {
      setTimeout(() => resolve({ type: 'mx', success: false }), DNS_TIMEOUT);
      dns.resolveMx(domain)
        .then(mxRecords => {
          if (Array.isArray(mxRecords) && mxRecords.length > 0) {
            resolve({ type: 'mx', success: true });
          } else {
            resolve({ type: 'mx', success: false });
          }
        })
        .catch(error => {
          markDnsAvailability(error);
          resolve({ type: 'mx', success: false });
        });
    }),
    // Try A records (IPv4)
    new Promise(resolve => {
      setTimeout(() => resolve({ type: 'a', success: false }), DNS_TIMEOUT);
      dns.resolve4(domain)
        .then(aRecords => {
          if (Array.isArray(aRecords) && aRecords.length > 0) {
            resolve({ type: 'a', success: true });
          } else {
            resolve({ type: 'a', success: false });
          }
        })
        .catch(error => {
          markDnsAvailability(error);
          resolve({ type: 'a', success: false });
        });
    }),
  ]);

  // Check if any lookup succeeded
  const hasValidDns = results.some(r => r.success);
  if (hasValidDns) {
    setCachedDnsResult(domain, true);
    return true;
  }

  // In restricted environments DNS may be unavailable; do not hard-block valid-looking emails.
  if (dnsUnavailable) {
    setCachedDnsResult(domain, true);
    return true;
  }

  setCachedDnsResult(domain, false);
  return false;
}

// Create singleton transporter instance for email sending
let otpTransporter = null;

const getOtpTransporter = () => {
  if (!otpTransporter) {
    otpTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      rateDelta: 1000,
      rateLimit: 5,
    });
  }
  return otpTransporter;
};

const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

const sendSignupOtpEmail = async (email, name, otp) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
    throw new Error('Email service is not configured. Please set EMAIL_USER and EMAIL_PASSWORD.');
  }

  const safeName = String(name || '').trim() || 'Farmer';
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #0f172a;">
      <h2 style="margin-bottom: 8px;">FarmAlert Verification Code</h2>
      <p>Hello ${safeName},</p>
      <p>Your OTP for FarmAlert signup is:</p>
      <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px; margin: 12px 0; color: #0f766e;">${otp}</p>
      <p>This OTP is valid for 10 minutes.</p>
      <p>If you did not request this, please ignore this email.</p>
    </div>
  `;

  const otpTransporter = getOtpTransporter();

  const info = await otpTransporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'FarmAlert Signup OTP Verification',
    html,
  });

  const acceptedCount = Array.isArray(info?.accepted) ? info.accepted.length : 0;
  const rejectedCount = Array.isArray(info?.rejected) ? info.rejected.length : 0;
  if (acceptedCount === 0 || rejectedCount > 0) {
    throw new Error('Email delivery failed. Please check the email address and try again.');
  }
};

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'your-secret-key-change-this', {
    expiresIn: '7d',
  });
};

// @desc    Register user / Sign up
// @route   POST /api/auth/signup
// @access  Public
exports.signup = async (req, res) => {
  try {
    const { name, email, password, confirmPassword } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const trimmedName = String(name || '').trim();

    // Validation
    if (!normalizedEmail || !password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields',
      });
    }

    if (!isValidEmailFormat(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address.',
      });
    }

    const deliverableDomain = await hasDeliverableEmailDomain(normalizedEmail);
    if (!deliverableDomain) {
      return res.status(400).json({
        success: false,
        message: 'Email domain is invalid. Please enter a real email address.',
      });
    }

    if (trimmedName.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Please enter your full name.',
      });
    }

    // Check if passwords match
    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match',
      });
    }

    // Check if password is at least 6 characters
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters',
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: normalizedEmail }).select('+emailOtp +emailOtpExpires +password');
    const otp = generateOtp();
    const otpExpires = new Date(Date.now() + OTP_VALIDITY_MS);

    if (existingUser && existingUser.emailVerified) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists',
      });
    }

    let user = existingUser;
    if (!user) {
      user = await User.create({
        name: trimmedName,
        email: normalizedEmail,
        password,
        emailVerified: false,
        emailOtp: otp,
        emailOtpExpires: otpExpires,
      });
    } else {
      user.name = trimmedName;
      user.password = password;
      user.emailVerified = false;
      user.emailOtp = otp;
      user.emailOtpExpires = otpExpires;
      await user.save();
    }

    // Send email asynchronously to avoid blocking response
    sendSignupOtpEmail(normalizedEmail, trimmedName, otp).catch(error => {
      console.error('Failed to send signup OTP email:', error?.message || error);
    });

    return res.status(200).json({
      success: true,
      requiresOtp: true,
      message: 'OTP sent to your email. Please verify to complete signup.',
      email: normalizedEmail,
    });
  } catch (error) {
    console.error('Signup error:', error);
    if (error?.name === 'ValidationError' && error?.errors?.email) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address.',
      });
    }
    res.status(500).json({
      success: false,
      message: error.message || 'Error during signup',
    });
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();

    // Validation
    if (!normalizedEmail || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password',
      });
    }

    if (!isValidEmailFormat(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address.',
      });
    }

    // Check if user exists (need to select password field explicitly)
    const user = await User.findOne({ email: normalizedEmail }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    if (!user.emailVerified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email with OTP before logging in.',
      });
    }

    // Check if password matches
    const isPasswordCorrect = await user.matchPassword(password);

    if (!isPasswordCorrect) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    // Generate token
    const token = generateToken(user._id);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar || "",
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error during login',
    });
  }
};

// @desc    Verify signup OTP and activate account
// @route   POST /api/auth/verify-signup-otp
// @access  Public
exports.verifySignupOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedOtp = String(otp || '').trim();

    if (!normalizedEmail || !normalizedOtp) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP are required.',
      });
    }

    if (!isValidEmailFormat(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address.',
      });
    }

    const user = await User.findOne({ email: normalizedEmail }).select('+emailOtp +emailOtpExpires');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No signup found for this email.',
      });
    }

    if (user.emailVerified) {
      const token = generateToken(user._id);
      return res.status(200).json({
        success: true,
        message: 'Email is already verified.',
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          avatar: user.avatar || '',
        },
      });
    }

    if (!user.emailOtp || !user.emailOtpExpires) {
      return res.status(400).json({
        success: false,
        message: 'OTP not generated. Please request a new OTP.',
      });
    }

    if (user.emailOtpExpires.getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new OTP.',
      });
    }

    if (user.emailOtp !== normalizedOtp) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP. Please try again.',
      });
    }

    user.emailVerified = true;
    user.emailOtp = '';
    user.emailOtpExpires = null;
    await user.save();

    const token = generateToken(user._id);
    return res.status(200).json({
      success: true,
      message: 'Email verified successfully.',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar || '',
      },
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Error verifying OTP',
    });
  }
};

// @desc    Resend signup OTP
// @route   POST /api/auth/resend-signup-otp
// @access  Public
exports.resendSignupOtp = async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (!normalizedEmail || !isValidEmailFormat(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address.',
      });
    }

    const deliverableDomain = await hasDeliverableEmailDomain(normalizedEmail);
    if (!deliverableDomain) {
      return res.status(400).json({
        success: false,
        message: 'Email domain is invalid. Please enter a real email address.',
      });
    }

    const user = await User.findOne({ email: normalizedEmail }).select('+emailOtp +emailOtpExpires');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No signup found for this email.',
      });
    }

    if (user.emailVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email is already verified. Please login.',
      });
    }

    const otp = generateOtp();
    user.emailOtp = otp;
    user.emailOtpExpires = new Date(Date.now() + OTP_VALIDITY_MS);
    await user.save();

    // Send email asynchronously to avoid blocking response
    sendSignupOtpEmail(user.email, user.name, otp).catch(error => {
      console.error('Failed to send resend OTP email:', error?.message || error);
    });

    return res.status(200).json({
      success: true,
      message: 'A new OTP has been sent to your email.',
    });
  } catch (error) {
    console.error('Resend OTP error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Error resending OTP',
    });
  }
};

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
exports.getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching user',
    });
  }
};

// @desc    Update current user profile
// @route   PUT /api/auth/profile
// @access  Private
exports.updateProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const incomingName = typeof req.body?.name === 'string' ? req.body.name.trim() : user.name;
    const incomingEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : user.email;
    const incomingAvatar = typeof req.body?.avatar === 'string' ? req.body.avatar.trim() : user.avatar;

    if (!incomingEmail) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    if (!isValidEmailFormat(incomingEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address.',
      });
    }

    if (incomingEmail !== user.email) {
      const existingUser = await User.findOne({ email: incomingEmail });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'User with this email already exists',
        });
      }
    }

    user.name = incomingName;
    user.email = incomingEmail;
    user.avatar = incomingAvatar || "";

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar || "",
      },
    });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error updating profile',
    });
  }
};

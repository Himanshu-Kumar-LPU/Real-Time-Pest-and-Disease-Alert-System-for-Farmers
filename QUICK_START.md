# Quick Start Guide - FarmAlert Backend

## 🚀 5-Minute Setup

### 1. Install Dependencies (1 minute)
```bash
npm install
```

### 2. Configure Database (1 minute)

Edit `.env` file:
```env
# For LOCAL MongoDB (easier for testing)
MONGODB_URI=mongodb://localhost:27017/farmalert

# For CLOUD MongoDB Atlas (recommended for production)
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/farmalert
```

### 3. Start MongoDB (1 minute)

**Windows:**
- MongoDB should run automatically as a service
- Or: `mongosh` (if installed)

**Mac:**
```bash
brew services start mongodb-community
```

**Linux:**
```bash
sudo systemctl start mongod
```

### 4. Start Server (1 minute)
```bash
npm start
```

Expected output:
```
✅ MongoDB connected successfully
🚀 Server starting...
Server running on port 3000
```

### 5. Test API (1 minute)

Open your browser and go to: **http://localhost:3000**

Or test with curl:

**Sign Up:**
```bash
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123","confirmPassword":"password123"}'
```

**Login:**
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

## ✅ You're Done!

Your frontend login form now connects to the backend. Try:
1. Go to http://localhost:3000/auth/login.html
2. Click "Sign up"
3. Create an account
4. Get redirected to dashboard
5. Try logging out and logging back in

## 📚 Full Documentation

See [BACKEND_SETUP.md](./BACKEND_SETUP.md) for:
- Complete folder structure
- Database configuration
- API endpoint details
- Error handling
- Security features
- Troubleshooting
- Production deployment

## 🆘 Common Issues

### "MongoDB connection error"
→ Start MongoDB: `mongosh` or check your .env MONGODB_URI

### "Cannot find module"
→ Run: `npm install`

### Server won't start
→ Check if port 3000 is already in use: `netstat -ano | findstr :3000`

---

**Tip:** Keep the terminal open while working. Server logs show all requests and errors.

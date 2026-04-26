const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  location: {
    type: String,
    required: true,
    trim: true
  },
  crop: {
    type: String,
    required: true,
    trim: true
  },
  problem: {
    type: String,
    required: true,
    trim: true
  },
  advice: {
    type: String,
    default: ""
  },
  imageUrl: {
    type: String,
    default: ""
  },
  reportedAt: {
    type: Date,
    default: Date.now
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  userEmail: {
    type: String,
    lowercase: true,
    trim: true
  },
  guidance: {
    type: String,
    default: ""
  },
  guidanceUpdatedAt: {
    type: Date
  },
  guidanceUpdatedBy: {
    type: String
  }
}, { timestamps: true });

module.exports = mongoose.model('Report', reportSchema);

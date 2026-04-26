# 🌿 Smart Farming Assistant - FarmAlert

**A real-time pest and disease detection system for farmers using AI/ML and IoT sensors.**

[![Node.js](https://img.shields.io/badge/Node.js-18+-green)](https://nodejs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Latest-green)](https://www.mongodb.com/)
[![Python](https://img.shields.io/badge/Python-3.11+-blue)](https://www.python.org/)
[![License](https://img.shields.io/badge/License-MIT-blue)](#license)

---

## 📋 Table of Contents

- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Architecture](#-architecture)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Deployment](#-deployment)
- [Project Structure](#-project-structure)
- [API Endpoints](#-api-endpoints)
- [Contributing](#-contributing)

---

## ✨ Features

### 🎯 Core Features
- **Real-time Alerts** - Instant notifications for pest/disease detections
- **AI-Powered Detection** - TensorFlow/Keras-based image classification
- **User Authentication** - JWT-based secure login with OTP verification
- **Admin Dashboard** - Manage reports, users, and view statistics
- **Multi-language Support** - English & Hindi interface
- **Weather Integration** - Real-time weather data for better predictions
- **Report Management** - Submit and track field observations
- **Dark Mode** - Eye-friendly dark theme option

### 📊 Dashboard Features
- Disease alert cards with expandable details
- Comprehensive guidance with AI-generated solutions
- Plant health status monitoring
- Weather forecasts and alerts
- User profile management

### 🔐 Admin Features
- User management (view, delete users)
- Report monitoring and deletion
- Statistics and crop trends
- System monitoring

---

## 🏗️ Architecture

### **System Architecture Diagram**

```mermaid
graph TB
    subgraph Frontend["📱 Frontend Layer"]
        A["HTML/CSS/JS<br/>Dashboard"]
        B["Mobile Responsive<br/>UI"]
        C["Auth Pages<br/>Login/Signup"]
    end
    
    subgraph Backend["🖥️ Backend Layer"]
        D["Express.js<br/>REST API"]
        E["JWT Auth<br/>Middleware"]
        F["Image Processing<br/>Pipeline"]
    end
    
    subgraph Database["💾 Data Layer"]
        G["MongoDB<br/>Users & Reports"]
        H["File Storage<br/>Images"]
    end
    
    subgraph ML["🤖 ML/AI Layer"]
        I["TensorFlow<br/>Keras Model"]
        J["Groq API<br/>LLM Guidance"]
        K["Plant Disease<br/>Classifier"]
    end
    
    subgraph External["🌐 External Services"]
        L["Weather API<br/>OpenWeatherMap"]
        M["Hugging Face<br/>LLM Router"]
    end
    
    A -->|HTTP/REST| D
    B -->|WebSocket| D
    C -->|Auth Token| E
    D -->|Query/Update| G
    D -->|Store/Retrieve| H
    D -->|Predict| I
    I -->|Classification| K
    F -->|Process Image| K
    D -->|Get Guidance| J
    J -->|Route| M
    D -->|Fetch Weather| L
```

### **Data Flow Diagram**

```mermaid
graph LR
    User["👨‍🌾 Farmer User"] -->|Upload Image| App["FarmAlert App"]
    App -->|API Request| Backend["Backend Server"]
    Backend -->|Process Image| ML["ML Model<br/>Disease Detection"]
    ML -->|Confidence Score| Backend
    Backend -->|Generate Text| LLM["LLM<br/>Groq API"]
    LLM -->|Guidance Text| Backend
    Backend -->|Store Data| DB["MongoDB<br/>Database"]
    Backend -->|Alert| App
    App -->|Display Results| User
    User -->|View Reports| Admin["👨‍💼 Admin Portal"]
    Admin -->|Manage Data| Backend
```

### **Authentication Flow**

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant Backend
    participant Database
    
    User->>Frontend: Enter Email & Password
    Frontend->>Backend: POST /api/auth/signup
    Backend->>Database: Create User
    Backend->>Backend: Send OTP Email
    User->>Frontend: Enter OTP
    Frontend->>Backend: POST /api/auth/verify-signup-otp
    Backend->>Backend: Verify OTP
    Backend->>Frontend: Return JWT Token
    Frontend->>Frontend: Store Token in localStorage
    Frontend->>Backend: Authenticated Requests with JWT
    Backend->>Backend: Verify Token
    Backend->>Frontend: Return Protected Data
```

### **Disease Detection Pipeline**

```mermaid
graph TD
    A["User Uploads Image"] -->|Validate Format| B["Image Preprocessing"]
    B -->|Resize & Normalize| C["TensorFlow Model"]
    C -->|Run Inference| D["Confidence Score"]
    D -->|High Confidence| E["Generate Alert"]
    D -->|Low Confidence| F["Manual Review Required"]
    E -->|Prepare Prompt| G["Groq LLM API"]
    G -->|Generate Guidance| H["Store in Database"]
    H -->|Send Alert| I["Notify User"]
    F -->|Admin Review| J["Update Prediction"]
```

---

## 🛠️ Tech Stack

### **Frontend**
- **HTML5** - Semantic markup
- **CSS3** - Modern styling with gradients, animations
- **Vanilla JavaScript** - No framework, lightweight
- **Features**: Responsive design, offline support, PWA-ready

### **Backend**
- **Node.js & Express.js** - REST API server
- **MongoDB & Mongoose** - Database and ODM
- **JWT** - Secure authentication
- **Nodemailer** - Email notifications (OTP)
- **Axios** - HTTP requests
- **Multer** - File upload handling

### **Machine Learning**
- **TensorFlow/Keras** - Deep learning framework
- **Python 3.11** - ML runtime
- **Flask** - Python API wrapper (optional)

### **External APIs**
- **Groq AI** - LLM for guidance generation
- **Hugging Face** - Alternative LLM routing
- **OpenWeatherMap** - Weather data
- **Google Identity Services** - OAuth (optional)

### **DevOps & Deployment**
- **Git/GitHub** - Version control
- **Docker** - Containerization (optional)
- **Render.com** - Hosting platform
- **MongoDB Atlas** - Cloud database

---

## 🚀 Installation

### **Prerequisites**
- Node.js 18+
- Python 3.11+
- MongoDB (local or Atlas cloud)
- Git

### **Step 1: Clone Repository**

```bash
git clone https://github.com/Himanshu-Kumar-LPU/Smart-Farming-Assistant.git
cd Smart-Farming-Assistant
```

### **Step 2: Install Backend Dependencies**

```bash
npm install
```

### **Step 3: Install Python Dependencies (Optional - for ML)**

```bash
python -m venv .venv311
.venv311\Scripts\activate  # Windows
# or
source .venv311/bin/activate  # macOS/Linux

cd python_api
pip install -r requirements.txt
```

### **Step 4: Configure Environment Variables**

```bash
cp .env.example .env
```

Edit `.env` file with your credentials:
```env
GROQ_API_KEY=your-groq-api-key
MONGODB_URI=your-mongodb-connection-string
JWT_SECRET=your-secret-key
ADMIN_PASSWORD=your-admin-password
```

### **Step 5: Start the Server**

```bash
npm start
```

Server runs on: **http://localhost:3000**

---

## ⚙️ Configuration

### **Environment Variables**

| Variable | Description | Default |
|----------|-------------|---------|
| `GROQ_API_KEY` | Groq AI API key for guidance generation | Required |
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/farmalert` |
| `JWT_SECRET` | Secret key for JWT tokens | `your-secret-key` |
| `ADMIN_PASSWORD` | Admin dashboard password | Required |
| `WEATHER_API_KEY` | Weather API key (optional) | Optional |
| `HTTPS_DEV` | Enable HTTPS in development | `false` |

### **MongoDB Setup**

**Local MongoDB:**
```bash
# Windows
mongod

# macOS (Homebrew)
brew services start mongodb-community
```

**MongoDB Atlas (Cloud):**
1. Go to https://www.mongodb.com/cloud/atlas
2. Create free account
3. Create a cluster
4. Copy connection string
5. Add to `.env`: `MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/farmalert`

---

## 📱 Project Structure

```
Smart-Farming-Assistant/
├── frontend/                    # Frontend files
│   ├── index.html              # Dashboard
│   ├── alerts.html             # Alerts page
│   ├── report.html             # Report submission
│   ├── admin.html              # Admin dashboard
│   ├── auth/login.html         # Login/Signup page
│   ├── script.js               # Main JavaScript logic
│   ├── style.css               # Global styles
│   ├── translations.js         # Language translations
│   └── manifest.json           # PWA manifest
│
├── backend/                     # Backend files
│   ├── server.js               # Express server
│   ├── config/
│   │   └── db.js               # MongoDB connection
│   ├── models/
│   │   └── User.js             # User schema
│   ├── controllers/
│   │   └── authController.js   # Auth logic
│   ├── middleware/
│   │   └── auth.js             # JWT verification
│   ├── routes/
│   │   └── auth.js             # Auth endpoints
│   └── data.json               # Reports storage
│
├── python_api/                  # Python ML API (optional)
│   ├── app.py                  # Flask server
│   ├── train_model.py          # Model training
│   ├── predict_image.py        # Prediction logic
│   ├── models/
│   │   └── leaf_model.keras    # Trained model
│   └── requirements.txt        # Python dependencies
│
├── Dataset/                     # Training dataset
│   ├── train/                  # Training images
│   └── valid/                  # Validation images
│
├── .env.example                # Environment variables template
├── .gitignore                  # Git ignore rules
├── package.json                # Node dependencies
├── README.md                   # This file
└── LICENSE                     # MIT License
```

---

## 🔌 API Endpoints

### **Authentication**
```
POST   /api/auth/signup              - Register new user
POST   /api/auth/login               - Login user
POST   /api/auth/verify-signup-otp   - Verify OTP
POST   /api/auth/resend-signup-otp   - Resend OTP
GET    /api/auth/me                  - Get current user
PUT    /api/auth/profile             - Update profile
```

### **Alerts & Reports**
```
GET    /alerts                       - Get all alerts
POST   /report                       - Submit new report
GET    /api/admin/reports            - Get all reports (admin)
DELETE /api/admin/reports/:id        - Delete report (admin)
```

### **Admin**
```
POST   /api/admin/login              - Admin login
GET    /api/admin/users              - Get all users (admin)
DELETE /api/admin/users/:id          - Delete user (admin)
GET    /api/admin/stats              - Get statistics (admin)
```

---

## 🌐 Deployment

### **Deploy to Render.com**

1. **Create Render Account**: https://render.com
2. **Push to GitHub**: Follow steps below
3. **Create Web Service** in Render dashboard
4. **Add Environment Variables**:
   ```
   MONGODB_URI=your-mongodb-atlas-uri
   JWT_SECRET=your-secret-key
   GROQ_API_KEY=your-groq-key
   ADMIN_PASSWORD=your-admin-password
   ```
5. **Deploy** - Automatic on GitHub push

### **Deploy to Heroku**

```bash
heroku login
heroku create your-app-name
git push heroku main
heroku config:set MONGODB_URI=your-uri
heroku config:set GROQ_API_KEY=your-key
```

### **Deploy to AWS EC2**

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions.

---

## 🧪 Testing

### **Test Dashboard**
1. Go to http://localhost:3000
2. Sign up with email
3. Verify OTP sent to email
4. View dashboard with sample alerts

### **Test Admin Portal**
1. Go to http://localhost:3000/frontend/admin.html
2. Click "Admin Login"
3. Password: `admin` (default, set in `.env`)
4. View reports, users, statistics

### **Test Report Submission**
1. Login as farmer
2. Go to "Report Issue"
3. Upload plant image
4. Fill details
5. Submit and view AI guidance

---

## 📦 Database Schema

### **User Model**
```javascript
{
  _id: ObjectId,
  name: String,
  email: String (unique),
  password: String (hashed),
  emailVerified: Boolean,
  avatar: String (URL),
  createdAt: Date,
  updatedAt: Date
}
```

### **Alert/Report Model**
```javascript
{
  id: Number,
  name: String,
  location: String,
  crop: String,
  problem: String,
  guidance: String (AI-generated),
  imageUrl: String,
  language: String,
  userId: ObjectId,
  userEmail: String,
  reportedAt: Date
}
```

---

## 🔐 Security Features

- ✅ JWT-based authentication
- ✅ Password hashing with bcryptjs
- ✅ OTP verification for signup
- ✅ Admin token validation
- ✅ Input validation & sanitization
- ✅ CORS protection
- ✅ Environment variable encryption
- ✅ SQL injection prevention (MongoDB)

---

## 📞 Support

- **Issues**: Create GitHub issue
- **Documentation**: See README files in each directory
- **Email**: kumarhimanshu9605@gmail.com

---

## 📜 License

This project is licensed under the MIT License - see [LICENSE](./LICENSE) file for details.

---

## 👥 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

---

## 🎯 Roadmap

- [ ] Mobile app (React Native)
- [ ] Real-time WebSocket alerts
- [ ] IoT sensor integration
- [ ] Advanced ML models
- [ ] Multi-language expansion
- [ ] Offline-first PWA
- [ ] Payment integration
- [ ] Video detection support

---

**Made with ❤️ for Indian Farmers**

---

## Quick Links

- 🔗 [Live Demo](https://farmalert.onrender.com)
- 📖 [Documentation](./docs/)
- 🐛 [Report Bug](https://github.com/Himanshu-Kumar-LPU/Smart-Farming-Assistant/issues)
- ⭐ [Star Repository](https://github.com/Himanshu-Kumar-LPU/Smart-Farming-Assistant)

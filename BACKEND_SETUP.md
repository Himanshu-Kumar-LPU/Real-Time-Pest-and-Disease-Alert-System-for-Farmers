# FarmAlert - Complete Backend Authentication System Setup Guide

## Project Structure

```
project/
├── backend/
│   ├── config/
│   │   └── db.js                 # MongoDB connection configuration
│   ├── models/
│   │   └── User.js               # User schema with bcrypt hashing
│   ├── routes/
│   │   └── auth.js               # Authentication API routes
│   ├── controllers/
│   │   └── authController.js     # Authentication logic (signup/login)
│   ├── middleware/
│   │   └── auth.js               # JWT verification middleware
│   ├── server.js                 # Main Express server
│   ├── data.json                 # Data storage file
│   └── chat-debug.log            # Debug logs
├── frontend/
│   ├── auth/
│   │   └── login.html            # Login/Signup page
│   ├── script.js                 # Frontend JavaScript (updated with API calls)
│   ├── style.css                 # Styling
│   └── index.html                # Dashboard
├── .env                          # Environment variables
└── package.json                  # Dependencies
```

## Prerequisites

1. **Node.js** (v14 or higher) - [Download](https://nodejs.org/)
2. **MongoDB** - Either:
   - Local MongoDB: [Download](https://www.mongodb.com/try/download/community)
   - MongoDB Atlas (Cloud): [Free account](https://www.mongodb.com/cloud/atlas)
3. **npm** - Comes with Node.js

## Installation Steps

### Step 1: Install Dependencies

```bash
cd project
npm install
```

This will install all required packages:
- **express** - Web framework
- **mongoose** - MongoDB ODM
- **bcryptjs** - Password hashing
- **jsonwebtoken** - JWT authentication
- **cors** - Cross-origin requests
- **dotenv** - Environment variables
- **groq-sdk** - AI integration (already installed)

### Step 2: Set Up MongoDB

#### Option A: Local MongoDB

1. Download and install MongoDB Community Edition
2. Start MongoDB service:
   - **Windows**: MongoDB should run as a service automatically
   - **Mac**: `brew services start mongodb-community`
   - **Linux**: `sudo systemctl start mongod`

3. Verify MongoDB is running:
   ```bash
   mongosh
   ```

#### Option B: MongoDB Atlas (Cloud)

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a free account
3. Create a new cluster
4. Get your connection string (it will look like):
   ```
   mongodb+srv://username:password@cluster.mongodb.net/farmalert?retryWrites=true&w=majority
   ```

### Step 3: Configure Environment Variables

Update `.env` file in the project root:

```env
# Existing variables
GROQ_API_KEY=your_groq_api_key
HUGGING_FACE_API_KEY=your_hugging_face_api_key

# MongoDB Configuration
# For local MongoDB:
MONGODB_URI=mongodb://localhost:27017/farmalert

# For MongoDB Atlas (replace with your credentials):
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/farmalert?retryWrites=true&w=majority

# JWT Configuration (Keep secret in production!)
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
```

### Step 4: Start the Server

```bash
npm start
```

You should see:
```
✅ MongoDB connected successfully
🚀 Server starting...
Server running on port 3000
```

The server will be available at: `http://localhost:3000`

## API Endpoints

### Authentication Routes (Base: `/api/auth`)

#### 1. **Sign Up**
```
POST /api/auth/signup
Content-Type: application/json

Body:
{
  "email": "user@example.com",
  "password": "password123",
  "confirmPassword": "password123"
}

Response (Success):
{
  "success": true,
  "message": "Account created successfully",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "user@example.com"
  }
}

Response (Error):
{
  "success": false,
  "message": "User with this email already exists"
}
```

#### 2. **Login**
```
POST /api/auth/login
Content-Type: application/json

Body:
{
  "email": "user@example.com",
  "password": "password123"
}

Response (Success):
{
  "success": true,
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "user@example.com"
  }
}
```

#### 3. **Get Current User** (Protected)
```
GET /api/auth/me
Authorization: Bearer <your_token>

Response:
{
  "success": true,
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "user@example.com",
    "createdAt": "2024-01-17T10:30:00.000Z"
  }
}
```

## Frontend Integration

The frontend has been updated to:

### 1. **Login/Signup Form** (`frontend/auth/login.html`)
- Sends POST requests to `/api/auth/signup` or `/api/auth/login`
- Stores JWT token in `localStorage`
- Redirects to dashboard on success

### 2. **API Token Usage** (`frontend/script.js`)
The `fetchApi` function automatically includes JWT token:

```javascript
// Token is automatically added by fetchApi()
const response = await fetchApi('/api/auth/me');
```

### 3. **LocalStorage Keys Used**
```javascript
farmalert_token        // JWT token for API requests
farmalert_logged_in    // Boolean flag (deprecated, use token)
farmalert_user_email   // Logged-in user's email
farmalert_user_id      // Logged-in user's MongoDB ID
```

### 4. **Logout Function**
```javascript
function logout() {
  localStorage.removeItem("farmalert_token");
  localStorage.removeItem("farmalert_logged_in");
  localStorage.removeItem("farmalert_user_email");
  localStorage.removeItem("farmalert_user_id");
  window.location.href = "auth/login.html";
}
```

## Testing the Authentication System

### Test 1: Sign Up
```bash
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123",
    "confirmPassword": "password123"
  }'
```

### Test 2: Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'
```

### Test 3: Access Protected Route
```bash
curl -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer <your_token_from_login>"
```

## Error Handling

The authentication system handles:

✅ **Validation Errors**
- Missing email or password
- Invalid email format
- Password too short (< 6 characters)
- Passwords don't match

✅ **Authentication Errors**
- User doesn't exist
- Invalid password
- Duplicate email on signup
- Invalid or expired token

✅ **Database Errors**
- MongoDB connection failures
- Query errors (graceful degradation)

## Security Features Implemented

🔒 **Password Security**
- Passwords hashed with bcryptjs (salt rounds: 10)
- Never stored in plain text
- Passwords not returned in API responses

🔐 **JWT Tokens**
- Tokens expire after 7 days
- Verified on protected routes
- Sent as Bearer token in Authorization header

✔️ **Input Validation**
- Email validation using regex
- Password minimum length (6 chars)
- SQL injection prevention via Mongoose

## Database Schema

### User Model
```javascript
{
  _id: ObjectId,           // MongoDB ID
  email: String,           // Unique, lowercase
  password: String,        // Hashed with bcryptjs
  createdAt: Date,         // Auto-generated
  updatedAt: Date,         // Auto-updated
  timestamps: true         // Auto-update on changes
}
```

## Troubleshooting

### Issue: "MongoDB connection error"
**Solution:**
1. Check if MongoDB is running: `mongosh`
2. Verify MONGODB_URI in .env
3. For local: Use `mongodb://localhost:27017/farmalert`
4. For Atlas: Check credentials and IP whitelist

### Issue: "Cannot find module 'mongoose'"
**Solution:**
```bash
npm install mongoose bcryptjs jsonwebtoken
```

### Issue: "Token is invalid or expired"
**Solution:**
- Clear localStorage: `localStorage.clear()`
- Log out and log back in
- Check if JWT_SECRET matches between signup and login

### Issue: CORS errors
**Solution:**
- Verify server is running on port 3000
- Check that frontend and backend are on same origin for requests
- CORS is enabled in server.js: `app.use(cors())`

## Production Deployment

Before deploying to production:

1. **Change JWT_SECRET**
   ```env
   JWT_SECRET=generate-a-long-random-string-here
   ```

2. **Use MongoDB Atlas (Cloud)**
   ```env
   MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/farmalert?retryWrites=true&w=majority
   ```

3. **Enable HTTPS**
   - Use reverse proxy (Nginx)
   - Use services like Heroku, Vercel, or AWS

4. **Set Environment to Production**
   ```env
   NODE_ENV=production
   ```

## File Locations Summary

| File | Purpose |
|------|---------|
| `backend/config/db.js` | MongoDB connection |
| `backend/models/User.js` | User database schema |
| `backend/controllers/authController.js` | Login/signup logic |
| `backend/routes/auth.js` | API route definitions |
| `backend/middleware/auth.js` | JWT verification |
| `backend/server.js` | Main Express server |
| `frontend/script.js` | Frontend API integration |
| `.env` | Environment configuration |

## Next Steps

1. ✅ Test signup and login
2. ✅ Verify tokens are stored correctly
3. ✅ Add user profile page
4. ✅ Implement password reset
5. ✅ Add OAuth (Google, Facebook)
6. ✅ Deploy to production

## Support

For issues or questions:
1. Check the error message in browser console (F12)
2. Check server logs (terminal output)
3. Verify all dependencies are installed: `npm list`
4. Restart the server: `npm start`

---

**Made with ❤️ for FarmAlert**

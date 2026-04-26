# MongoDB Setup Guide

## Option 1: Local MongoDB (Easiest for Development)

### Windows

1. **Download MongoDB Community Edition**
   - Go to: https://www.mongodb.com/try/download/community
   - Select Windows
   - Download MSI installer
   - Run the installer

2. **MongoDB should now run automatically as a Windows Service**

3. **Verify MongoDB is running:**
   ```bash
   mongosh
   ```
   You should see: `test>`

4. **Connection string for .env:**
   ```env
   MONGODB_URI=mongodb://localhost:27017/farmalert
   ```

### Mac

1. **Install MongoDB using Homebrew**
   ```bash
   brew tap mongodb/brew
   brew install mongodb-community
   ```

2. **Start MongoDB**
   ```bash
   brew services start mongodb-community
   ```

3. **Verify MongoDB is running:**
   ```bash
   mongosh
   ```

4. **Connection string for .env:**
   ```env
   MONGODB_URI=mongodb://localhost:27017/farmalert
   ```

### Linux (Ubuntu/Debian)

1. **Install MongoDB**
   ```bash
   sudo apt-get update
   sudo apt-get install mongodb
   ```

2. **Start MongoDB**
   ```bash
   sudo systemctl start mongod
   ```

3. **Enable auto-start**
   ```bash
   sudo systemctl enable mongod
   ```

4. **Verify MongoDB is running:**
   ```bash
   mongosh
   ```

5. **Connection string for .env:**
   ```env
   MONGODB_URI=mongodb://localhost:27017/farmalert
   ```

---

## Option 2: MongoDB Atlas (Cloud - Recommended)

### Step-by-Step Setup

#### 1. Create Free Account
- Go to: https://www.mongodb.com/cloud/atlas
- Click "Sign Up"
- Create account with email

#### 2. Create Organization & Project
- Create Organization (name: FarmAlert)
- Create Project (name: farmalert-dev)

#### 3. Create Cluster
1. Click "Create Deployment"
2. Choose **Free (M0)**
3. Select Cloud Provider: **AWS**
4. Select Region: Closest to you
5. Click "Create Deployment"
6. Wait 2-3 minutes for cluster creation

#### 4. Set Up Database User
1. Click "Database Access" (left menu)
2. Click "Add New Database User"
3. **Username**: `farmalert_user` (or any username)
4. **Password**: Generate secure password (save it!)
5. Database User Privileges: **Read and write to any database**
6. Click "Add User"

#### 5. Set Up Network Access
1. Click "Network Access" (left menu)
2. Click "Add IP Address"
3. Choose **Allow access from anywhere** (for development)
   - IP: 0.0.0.0/0
4. Click "Confirm"

**Note:** For production, use your server's IP address instead.

#### 6. Get Connection String
1. Go back to "Database" (left menu)
2. Click "Connect" on your cluster
3. Choose "Drivers"
4. Select "Node.js" and version 3.0+
5. Copy the connection string

The connection string looks like:
```
mongodb+srv://farmalert_user:password@cluster.mongodb.net/?retryWrites=true&w=majority
```

#### 7. Add Database Name
Modify the connection string:
```
mongodb+srv://farmalert_user:password@cluster.mongodb.net/farmalert?retryWrites=true&w=majority
```

Replace:
- `farmalert_user` with your username
- `password` with your password

#### 8. Update .env File
```env
MONGODB_URI=mongodb+srv://farmalert_user:password@cluster.mongodb.net/farmalert?retryWrites=true&w=majority
JWT_SECRET=your-super-secret-jwt-key
```

---

## Testing Your Connection

### Test 1: Using mongosh (Local Only)

```bash
mongosh
```

Create test database:
```bash
use farmalert
db.test.insertOne({name: "test"})
db.test.findOne()
```

### Test 2: Using Your Application

After starting your server:
```bash
npm start
```

You should see:
```
✅ MongoDB connected successfully
```

### Test 3: Using curl

Create a user:
```bash
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123",
    "confirmPassword": "password123"
  }'
```

Success response:
```json
{
  "success": true,
  "message": "Account created successfully",
  "token": "...",
  "user": {"id": "...", "email": "test@example.com"}
}
```

---

## Viewing Your Database

### Using MongoDB Compass (GUI)

1. Download: https://www.mongodb.com/products/compass
2. Install it
3. Connection string:
   - Local: `mongodb://localhost:27017`
   - Atlas: Use your full connection string
4. Connect and browse data

### Using mongosh (CLI)

```bash
# Connect to local
mongosh

# Or connect to Atlas
mongosh "mongodb+srv://username:password@cluster.mongodb.net/farmalert"
```

View databases:
```bash
show dbs
use farmalert
show collections
db.users.find()
```

---

## Troubleshooting

### "Connection refused" (Local MongoDB)
- Verify MongoDB is running: `mongosh`
- Windows: Check Services (Ctrl+R → services.msc → MongoDB)
- Mac: `brew services list`
- Linux: `sudo systemctl status mongod`

### "Authentication failed" (Atlas)
- Check username & password in connection string
- Verify user was created in Database Access
- Check IP whitelist (Network Access)

### "Invalid database name"
- Database name must be added to connection string
- Format: `...mongodb.net/database_name?retryWrites...`

### "Slow connection"
- Local MongoDB too slow? Switch to Atlas
- Atlas taking time? Check your internet connection
- Create new cluster if region is far

---

## Performance Tips

### Local MongoDB
- Good for: Development, testing
- Speed: Very fast
- Disk space: ~3.5 GB

### MongoDB Atlas
- Good for: Production, development
- Speed: Fast (depends on region)
- Cost: Free for M0 (shared)
- Storage: 512 MB free tier

### Optimization
- Add index on email: `db.users.createIndex({email: 1})`
- Monitor connection pool size
- Use connection pooling in production

---

## Backup & Restore

### Local MongoDB Backup
```bash
# Backup
mongodump --db farmalert --out ./backup

# Restore
mongorestore --db farmalert ./backup/farmalert
```

### Atlas Backup
- Automatic backups: Enable in cluster settings
- Manual backup: Go to "Backup" tab in Atlas
- Download & restore: Use mongorestore command above

---

## Security Best Practices

✅ **Do This:**
- Use strong passwords (20+ characters)
- Restrict IP access (Network Access)
- Use separate credentials for dev/prod
- Rotate passwords periodically
- Enable encryption (Atlas default)

❌ **Don't Do This:**
- Hard-code credentials in code
- Use "Allow from anywhere" in production
- Share connection strings
- Store passwords in version control
- Use default passwords

---

## Connection String Format

### Local MongoDB
```
mongodb://localhost:27017/farmalert
```

### MongoDB Atlas
```
mongodb+srv://username:password@cluster.mongodb.net/database?retryWrites=true&w=majority
```

## Environment Variable
```env
# .env file
MONGODB_URI=mongodb://localhost:27017/farmalert
# OR
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/farmalert?retryWrites=true&w=majority
```

---

## Summary

| Aspect | Local MongoDB | MongoDB Atlas |
|--------|--------------|--------------|
| Setup Time | 5 minutes | 10 minutes |
| Cost | Free | Free (M0) |
| Speed | Very Fast | Fast |
| Maintenance | You manage | MongoDB manages |
| Best For | Development | Production |
| Backups | Manual | Automatic |
| Scaling | Limited | Easy |

---

**Choose Local MongoDB for quick development, Atlas for production!**

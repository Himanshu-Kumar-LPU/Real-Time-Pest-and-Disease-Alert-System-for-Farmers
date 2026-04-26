const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });
console.log('GROQ_API_KEY loaded:', process.env.GROQ_API_KEY ? 'YES' : 'NO');
let groq = null;
let groqSdkAvailable = false;
const hasGroqApiKey = Boolean(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim());
try {
  const Groq = require('groq-sdk');
  console.log('require succeeded');
  groqSdkAvailable = true;
  if (hasGroqApiKey) {
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    console.log('new Groq succeeded');
  }
} catch (e) {
  console.error('caught error:', e.message);
}
console.log(JSON.stringify({ groqSdkAvailable, hasGroqApiKey, groq: !!groq }));

const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// تهيئة Firebase باستخدام قاعدة البيانات المحددة
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: process.env.FIREBASE_DATABASE_URL || "https://bode-7b8c9-default-rtdb.firebaseio.com"
  });
}
const db = admin.database();

// دالة إرسال إشعارات تيليجرام للأدمن
async function sendTelegramNotification(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN || "8981934351:AAGdpG7tfR5viEaX_td0WYus8mmYIImSk6M";
  const chatId = process.env.TELEGRAM_CHAT_ID || "5926610601";
  if (!token || !chatId) return;
  
  try {
    const fetch = (await import('node-fetch')).default;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
    });
  } catch (err) {
    console.error("Telegram Error:", err);
  }
}

// 1. Health Check Endpoint (يجب أن يعيد JSON دائماً)
app.get('/api/health', (req, res) => {
  res.status(200).json({ success: true, status: 'ok', platform: 'منصة الكوتش' });
});

// 2. تسجيل طالب جديد (Custom Auth مع رقم الهاتف و PIN وحالة Pending وإشعار تيليجرام)
app.post('/api/student-register', async (req, res) => {
  try {
    const { name, phone, pin, grade } = req.body;
    if (!name || !phone || !pin || !grade) {
      return res.status(400).json({ success: false, message: 'جميع البيانات مطلوبة' });
    }

    const studentsRef = db.ref('students');
    const snapshot = await studentsRef.orderByChild('phone').equalTo(phone).once('value');
    if (snapshot.exists()) {
      return res.status(400).json({ success: false, message: 'رقم الهاتف مسجل مسبقاً' });
    }

    const salt = await bcrypt.genSalt(10);
    const pinHash = await bcrypt.hash(pin, salt);

    const newStudentRef = studentsRef.push();
    const studentData = {
      id: newStudentRef.key,
      name,
      phone,
      pinHash,
      grade,
      status: 'pending', // قيد الانتظار لحين موافقة الأدمن
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString()
    };

    await newStudentRef.set(studentData);

    // إرسال إشعار تيليجرام للأدمن بوجود طالب جديد
    await sendTelegramNotification(`🚨 <b>طالب جديد يطلب الانضمام إلى منصة الكوتش!</b>\n\n👤 الاسم: ${name}\n📱 الهاتف: ${phone}\n📚 الصف: ${grade}\n⏳ الحالة: قيد الانتظار (Pending)`);

    res.status(200).json({ success: true, message: 'تم تسجيل الحساب بنجاح وهو بانتظار موافقة الأدمن' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'حدث خطأ في الخادم' });
  }
});

// 3. تسجيل دخول الطالب (رقم الهاتف + PIN مع التحقق من الحالة)
app.post('/api/student-login', async (req, res) => {
  try {
    const { phone, pin } = req.body;
    if (!phone || !pin) {
      return res.status(400).json({ success: false, message: 'رقم الهاتف وكلمة المرور مطلوبة' });
    }

    const studentsRef = db.ref('students');
    const snapshot = await studentsRef.orderByChild('phone').equalTo(phone).once('value');
    if (!snapshot.exists()) {
      return res.status(401).json({ success: false, message: 'رقم الهاتف أو كلمة المرور غير صحيحة' });
    }

    const studentId = Object.keys(snapshot.val())[0];
    const student = snapshot.val()[studentId];

    const isMatch = await bcrypt.compare(pin, student.pinHash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'رقم الهاتف أو كلمة المرور غير صحيحة' });
    }

    if (student.status !== 'approved' && student.status !== 'active') {
      return res.status(403).json({ success: false, message: `حسابك حالياً (${student.status}). بانتظار موافقة الأدمن أو تفعيل الحساب.` });
    }

    // تعيين الجلسة (Session Cookie)
    res.cookie('student_session', studentId, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.status(200).json({ success: true, message: 'تم تسجيل الدخول بنجاح', student: { id: student.id, name: student.name, phone: student.phone, grade: student.grade } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'حدث خطأ في الخادم' });
  }
});

// التعامل مع أخطاء الـ API وإرجاع JSON دائماً لمنع مشكلة Unexpected token '<'
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'المسار غير موجود' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'خطأ داخلي في الخادم' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 منصة الكوتش تعمل بنجاح على البورت ${PORT}`);
});

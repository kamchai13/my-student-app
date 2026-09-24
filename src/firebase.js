import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// ตั้งค่าการเชื่อมต่อ Firebase (แก้ไข apiKey ให้ถูกต้องแล้ว)
const firebaseConfig = {
  apiKey: "AIzaSyDaPYyH9hz_s9OsnUMBD_fPkjFLKYjKUoc", // <--- ตรวจสอบการสะกด
  authDomain: "student-attendance-db.firebaseapp.com",
  projectId: "student-attendance-db",
  storageBucket: "student-attendance-db.firebasestorage.app",
  messagingSenderId: "862325141839",
  appId: "1:862392518439:web:99a0d21acb5661bb830b02"
};

// หากยังพบปัญหา ให้ไปคัดลอก apiKey ที่ถูกต้องแน่นอนจาก:
// Firebase Console -> Project Settings (รูปฟันเฟืองซ้ายบน) -> General -> แอป Web ของคุณ

// เริ่มต้นใช้งาน Firebase
const app = initializeApp(firebaseConfig);

// ส่งออก db และ auth
export const db = getFirestore(app);
export const auth = getAuth(app);

export default app;
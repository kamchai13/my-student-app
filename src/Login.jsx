import React, { useState } from 'react';
import { auth, db } from './firebase';
import { 
  signInWithEmailAndPassword, 
  sendPasswordResetEmail, 
  createUserWithEmailAndPassword 
} from 'firebase/auth';
import { 
  collection, 
  getDocs, 
  query, 
  where, 
  setDoc, 
  doc, 
  updateDoc 
} from 'firebase/firestore';

function Login({ onLoginSuccess }) {
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [isForgotPasswordMode, setIsForgotPasswordMode] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [name, setName] = useState('');

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);

  // --- 1. เข้าสู่ระบบ ---
  const handleLogin = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);

    try {
      // ลองเข้าสู่ระบบผ่าน Firebase Auth
      try {
        const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
        const user = userCredential.user;
        onLoginSuccess({
          uid: user.uid,
          email: user.email,
          name: user.displayName || user.email.split('@')[0]
        });
        return;
      } catch (authErr) {
        // หากไม่มีใน Auth ให้ลองค้นหาใน Firestore Collection 'teachers'
        const q = query(
          collection(db, 'teachers'),
          where('email', '==', email.trim()),
          where('password', '==', password)
        );
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
          const teacherDoc = querySnapshot.docs[0];
          onLoginSuccess({
            uid: teacherDoc.id,
            id: teacherDoc.id,
            ...teacherDoc.data()
          });
        } else {
          setErrorMsg('❌ อีเมลหรือรหัสผ่านไม่ถูกต้อง');
        }
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('❌ เกิดข้อผิดพลาดในการเข้าสู่ระบบ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
    }
  };

  // --- 2. สมัครสมาชิก ---
  const handleRegister = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);

    if (!email.trim() || !password || !name.trim()) {
      setErrorMsg('❌ กรุณากรอกข้อมูลให้ครบทุกช่อง');
      setLoading(false);
      return;
    }

    try {
      // สร้างบัญชีใน Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const user = userCredential.user;

      // บันทึกข้อมูลลง Firestore 'teachers'
      await setDoc(doc(db, 'teachers', user.uid), {
        email: email.trim(),
        name: name.trim(),
        password: password
      });

      setSuccessMsg('✅ สมัครสมาชิกสำเร็จ! กำลังเข้าสู่ระบบ...');
      setTimeout(() => {
        onLoginSuccess({
          uid: user.uid,
          email: user.email,
          name: name.trim()
        });
      }, 1500);
    } catch (err) {
      console.error(err);
      if (err.code === 'auth/email-already-in-use') {
        setErrorMsg('❌ อีเมลนี้ถูกใช้งานในระบบแล้ว');
      } else if (err.code === 'auth/weak-password') {
        setErrorMsg('❌ รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร');
      } else {
        // กรณีบันทึกลง Firestore โดยตรง
        const teacherId = 'T_' + Date.now();
        await setDoc(doc(db, 'teachers', teacherId), {
          email: email.trim(),
          name: name.trim(),
          password: password
        });
        setSuccessMsg('✅ สมัครสมาชิกสำเร็จ!');
        setTimeout(() => {
          onLoginSuccess({
            uid: teacherId,
            email: email.trim(),
            name: name.trim()
          });
        }, 1500);
      }
    } finally {
      setLoading(false);
    }
  };

  // --- 3. ระบบลืมรหัสผ่าน / รีเซ็ตรหัสผ่าน ---
  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);

    if (!email.trim()) {
      setErrorMsg('❌ กรุณากรอกอีเมลที่ต้องการรีเซ็ตรหัสผ่าน');
      setLoading(false);
      return;
    }

    try {
      // 1. ลองส่งอีเมลรีเซ็ตรหัสผ่านผ่าน Firebase Auth
      await sendPasswordResetEmail(auth, email.trim());
      setSuccessMsg(`📧 ส่งลิงก์รีเซ็ตรหัสผ่านไปยัง [${email.trim()}] เรียบร้อยแล้ว กรุณาตรวจสอบในกล่องข้อความ/สแปมของคุณ`);
    } catch (authErr) {
      console.warn('Auth reset failed, checking Firestore database...', authErr);

      // 2. หากไม่ได้ใช้ Auth ให้ค้นหาอีเมลใน Firestore แล้วทำการอัปเดตรหัสผ่านใหม่
      if (newPassword.trim()) {
        const q = query(collection(db, 'teachers'), where('email', '==', email.trim()));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
          const teacherDoc = querySnapshot.docs[0];
          await updateDoc(doc(db, 'teachers', teacherDoc.id), {
            password: newPassword.trim()
          });
          setSuccessMsg('✅ เปลี่ยนรหัสผ่านสำเร็จ! กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่');
          setTimeout(() => {
            setIsForgotPasswordMode(false);
            setPassword(newPassword.trim());
            setNewPassword('');
          }, 2000);
        } else {
          setErrorMsg('❌ ไม่พบอีเมลนี้ในระบบอาจารย์ผู้สอน');
        }
      } else {
        setErrorMsg('❌ กรุณากรอกรหัสผ่านใหม่ที่คุณต้องการตั้งค่า');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9', fontFamily: "'Sarabun', sans-serif", padding: '16px' }}>
      <div style={{ backgroundColor: '#fff', padding: '36px 32px', borderRadius: '16px', width: '100%', maxWidth: '400px', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.08)' }}>
        
        {/* Header Icon & Title */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>
            {isForgotPasswordMode ? '🔑' : isRegisterMode ? '📝' : '🔑'}
          </div>
          <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 'bold', color: '#0f172a' }}>
            {isForgotPasswordMode ? 'รีเซ็ตรหัสผ่าน' : isRegisterMode ? 'สมัครสมาชิกผู้ใช้งาน' : 'เข้าสู่ระบบ'}
          </h2>
          <p style={{ margin: '6px 0 0 0', fontSize: '14px', color: '#64748b' }}>
            ยินดีต้อนรับสู่ระบบเช็คชื่อนักศึกษา
          </p>
        </div>

        {/* Message Alert */}
        {errorMsg && (
          <div style={{ backgroundColor: '#fee2e2', color: '#b91c1c', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold', marginBottom: '16px', textAlign: 'center', lineHeight: '1.4' }}>
            {errorMsg}
          </div>
        )}
        {successMsg && (
          <div style={{ backgroundColor: '#dcfce7', color: '#15803d', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold', marginBottom: '16px', textAlign: 'center', lineHeight: '1.4' }}>
            {successMsg}
          </div>
        )}

        {/* FORM 1: ลืมรหัสผ่าน */}
        {isForgotPasswordMode ? (
          <form onSubmit={handleForgotPassword} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', color: '#334155', marginBottom: '6px' }}>
                อีเมลบัญชีผู้ใช้งาน:
              </label>
              <input
                type="email"
                placeholder="เช่น teacher@cmru.ac.th"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', boxSizing: 'border-box' }}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', color: '#334155', marginBottom: '6px' }}>
                ตั้งรหัสผ่านใหม่ (สำหรับบัญชีในระบบ):
              </label>
              <input
                type="password"
                placeholder="กรอกรหัสผ่านใหม่ที่ต้องการ"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', boxSizing: 'border-box' }}
              />
              <span style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px', display: 'block' }}>
                * ระบบจะส่งอีเมลรีเซ็ตไปที่กล่องข้อความ หรือแก้ไขรหัสผ่านใหม่ให้ทันที
              </span>
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{ width: '100%', padding: '12px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '15px', cursor: loading ? 'not-allowed' : 'pointer', marginTop: '8px' }}
            >
              {loading ? 'กำลังดำเนินการ...' : 'ส่งข้อมูลแก้ไขรหัสผ่าน'}
            </button>

            <button
              type="button"
              onClick={() => {
                setIsForgotPasswordMode(false);
                setErrorMsg('');
                setSuccessMsg('');
              }}
              style={{ width: '100%', padding: '10px', backgroundColor: 'transparent', color: '#64748b', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}
            >
              ⬅ กลับไปหน้าเข้าสู่ระบบ
            </button>
          </form>
        ) : isRegisterMode ? (
          /* FORM 2: สมัครสมาชิก */
          <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', color: '#334155', marginBottom: '6px' }}>
                ชื่อ-นามสกุล อาจารย์:
              </label>
              <input
                type="text"
                placeholder="เช่น อาจารย์ สมชัย ชัยชนะ"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', boxSizing: 'border-box' }}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', color: '#334155', marginBottom: '6px' }}>
                อีเมล:
              </label>
              <input
                type="email"
                placeholder="เช่น kamchai983@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', boxSizing: 'border-box' }}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', color: '#334155', marginBottom: '6px' }}>
                รหัสผ่าน:
              </label>
              <input
                type="password"
                placeholder="กำหนดรหัสผ่านอย่างน้อย 6 ตัวอักษร"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', boxSizing: 'border-box' }}
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{ width: '100%', padding: '12px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '15px', cursor: loading ? 'not-allowed' : 'pointer', marginTop: '8px' }}
            >
              {loading ? 'กำลังบันทึก...' : 'สมัครสมาชิก'}
            </button>

            <div style={{ textAlign: 'center', marginTop: '12px', fontSize: '13px', color: '#64748b' }}>
              มีบัญชีผู้ใช้งานอยู่แล้ว?{' '}
              <span
                onClick={() => {
                  setIsRegisterMode(false);
                  setErrorMsg('');
                  setSuccessMsg('');
                }}
                style={{ color: '#2563eb', fontWeight: 'bold', cursor: 'pointer', textDecoration: 'underline' }}
              >
                เข้าสู่ระบบที่นี่
              </span>
            </div>
          </form>
        ) : (
          /* FORM 3: เข้าสู่ระบบหลัก */
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', color: '#334155', marginBottom: '6px' }}>
                อีเมล:
              </label>
              <input
                type="email"
                placeholder="เช่น kamchai983@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', boxSizing: 'border-box' }}
                required
              />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={{ fontSize: '14px', fontWeight: 'bold', color: '#334155' }}>
                  รหัสผ่าน:
                </label>
                <span
                  onClick={() => {
                    setIsForgotPasswordMode(true);
                    setErrorMsg('');
                    setSuccessMsg('');
                  }}
                  style={{ fontSize: '12px', color: '#2563eb', fontWeight: 'bold', cursor: 'pointer', textDecoration: 'none' }}
                >
                  ลืมรหัสผ่าน?
                </span>
              </div>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', boxSizing: 'border-box' }}
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{ width: '100%', padding: '12px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '15px', cursor: loading ? 'not-allowed' : 'pointer', marginTop: '8px' }}
            >
              {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
            </button>

            <div style={{ textAlign: 'center', marginTop: '12px', fontSize: '13px', color: '#64748b' }}>
              ยังไม่มีบัญชีผู้ใช้งาน?{' '}
              <span
                onClick={() => {
                  setIsRegisterMode(true);
                  setErrorMsg('');
                  setSuccessMsg('');
                }}
                style={{ color: '#2563eb', fontWeight: 'bold', cursor: 'pointer', textDecoration: 'underline' }}
              >
                สมัครสมาชิกที่นี่
              </span>
            </div>
          </form>
        )}

      </div>
    </div>
  );
}

export default Login;
import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import * as XLSX from 'xlsx';
import { db } from './firebase';
import { 
  collection, 
  onSnapshot, 
  doc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  getDoc,
  getDocs,
  query, 
  where 
} from 'firebase/firestore';
import Login from './Login.jsx';

// ฟังก์ชันสร้าง Device Fingerprint
const getDeviceFingerprint = () => {
  const nav = window.navigator;
  const screen = window.screen;
  const str = `${nav.userAgent}_${screen.width}x${screen.height}_${screen.colorDepth}_${nav.language}`;
  
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return 'FP_' + Math.abs(hash).toString(36);
};

function App() {
  // --- ตรวจจับ Query Parameter จากการสแกน QR Code ของนักศึกษา ---
  const urlParams = new URLSearchParams(window.location.search);
  const studentSubjectParam = urlParams.get('subject');
  const tokenParam = urlParams.get('t');
  const weekParam = urlParams.get('w') || '1';

  // State สำหรับฝั่งนักศึกษา
  const [studentInputId, setStudentInputId] = useState('');
  const [studentStatusMsg, setStudentStatusMsg] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // State สำหรับฝั่งอาจารย์
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState('checkin'); // 'checkin' | 'management'
  
  const [students, setStudents] = useState([]);
  const [subjects, setSubjects] = useState([]); 
  const [selectedSubject, setSelectedSubject] = useState(''); 
  const [selectedWeek, setSelectedWeek] = useState(1);
  const [totalWeeks, setTotalWeeks] = useState(16);

  // QR Dynamic & Anti-Cheat States (เปลี่ยนทุก 10 วินาที)
  const [qrToken, setQrToken] = useState(Date.now());
  const [countdown, setCountdown] = useState(10);

  // Quick Student Add Form States
  const [quickStdId, setQuickStdId] = useState('');
  const [quickStdName, setQuickStdName] = useState('');
  const [showQuickAdd, setShowQuickAdd] = useState(false);

  // Subject Form States
  const [editingSubjectId, setEditingSubjectId] = useState(null);
  const [inputSubjectCode, setInputSubjectCode] = useState('');
  const [inputSubjectName, setInputSubjectName] = useState('');
  const [inputSec, setInputSec] = useState('');
  const [inputDay, setInputDay] = useState('วันจันทร์');
  const [inputStartTime, setInputStartTime] = useState('08:30');
  const [inputEndTime, setInputEndTime] = useState('11:30');
  const [inputRoom, setInputRoom] = useState('');

  // Excel Import State
  const [excelTargetSubject, setExcelTargetSubject] = useState('');

  // Custom Alert & Confirm Modal States
  const [customAlert, setCustomAlert] = useState({ isOpen: false, title: '', message: '', type: 'success' });
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: '', message: '', onConfirm: null });

  const showAlert = (title, message, type = 'success') => {
    setCustomAlert({ isOpen: true, title, message, type });
    setTimeout(() => {
      setCustomAlert((prev) => ({ ...prev, isOpen: false }));
    }, 2500);
  };

  const showConfirm = (title, message, onConfirmAction) => {
    setConfirmDialog({
      isOpen: true,
      title,
      message,
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        await onConfirmAction();
      }
    });
  };

  // Timer สำหรับรีเฟรช QR Code ทุกๆ 10 วินาที
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          setQrToken(Date.now());
          return 10;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // ดึงข้อมูล Realtime จาก Firestore
  useEffect(() => {
    if (!currentUser) return;

    const unsubStudents = onSnapshot(collection(db, 'students'), (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      setStudents(list);
    });

    const subjectsQuery = query(
      collection(db, 'subjects'),
      where('userId', '==', currentUser.uid || currentUser.id)
    );

    const unsubSubjects = onSnapshot(subjectsQuery, (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setSubjects(list);
      
      // อัปเดต selectedSubject เมื่อมีการเพิ่ม/ลบรายวิชา
      if (list.length > 0) {
        if (!selectedSubject || !list.some(s => s.id === selectedSubject)) {
          setSelectedSubject(list[0].id);
          setExcelTargetSubject(list[0].id);
        }
      } else {
        setSelectedSubject('');
        setExcelTargetSubject('');
      }
    });

    return () => {
      unsubStudents();
      unsubSubjects();
    };
  }, [currentUser, selectedSubject]);

  // --- ฟังก์ชันเพิ่มนักศึกษาด่วน ---
  const handleQuickAddStudent = async (e) => {
    e.preventDefault();
    if (!selectedSubject) {
      showAlert('กรุณาเลือกวิชา', 'กรุณาเลือกวิชาก่อนทำการเพิ่มนักศึกษา', 'error');
      return;
    }
    if (!quickStdId.trim() || !quickStdName.trim()) {
      showAlert('ข้อผิดพลาด', 'กรุณากรอกรหัสและชื่อนักศึกษาให้ครบถ้วน', 'error');
      return;
    }

    const stdId = quickStdId.trim();
    const currentStd = students.find(s => s.id === stdId);
    let currentSubjects = currentStd ? (currentStd.subjects || []) : [];

    if (!currentSubjects.includes(selectedSubject)) {
      currentSubjects.push(selectedSubject);
    }

    await setDoc(doc(db, 'students', stdId), {
      name: quickStdName.trim(),
      subjects: currentSubjects
    }, { merge: true });

    showAlert('สำเร็จ', `เพิ่มนักศึกษา [${stdId}] เรียบร้อยแล้ว`, 'success');
    setQuickStdId('');
    setQuickStdName('');
  };

  // --- ฟังก์ชันถอนนักศึกษาออกจากวิชา ---
  const handleRemoveStudentFromSubject = (stdId) => {
    showConfirm(
      'ยืนยันการลบนักศึกษา',
      `คุณต้องการลบนักศึกษารหัส [${stdId}] ออกจากวิชาใช่หรือไม่?`,
      async () => {
        const currentStd = students.find(s => s.id === stdId);
        if (!currentStd) return;

        const updatedSubjects = (currentStd.subjects || []).filter(sub => sub !== selectedSubject);

        await updateDoc(doc(db, 'students', stdId), {
          subjects: updatedSubjects
        });

        showAlert('สำเร็จ', `ลบนักศึกษารหัส [${stdId}] เรียบร้อยแล้ว`, 'success');
      }
    );
  };

  // --- ฟังก์ชันจัดการวิชา ---
  const handleSaveSubject = async (e) => {
    e.preventDefault();
    if (!inputSubjectCode || !inputSubjectName) {
      showAlert('ข้อผิดพลาด', 'กรุณากรอกรหัสวิชาและชื่อวิชา', 'error');
      return;
    }

    const subjectId = inputSubjectCode.trim();
    await setDoc(doc(db, 'subjects', subjectId), {
      name: inputSubjectName,
      sec: inputSec || '1',
      day: inputDay,
      startTime: inputStartTime,
      endTime: inputEndTime,
      room: inputRoom,
      userId: currentUser.uid || currentUser.id
    }, { merge: true });

    showAlert('สำเร็จ', editingSubjectId ? 'อัปเดตข้อมูลรายวิชาเรียบร้อยแล้ว' : 'เพิ่มรายวิชาเรียบร้อยแล้ว', 'success');
    handleResetSubjectForm();
  };

  const handleEditSubject = (sub) => {
    setEditingSubjectId(sub.id);
    setInputSubjectCode(sub.id);
    setInputSubjectName(sub.name || '');
    setInputSec(sub.sec || '');
    setInputDay(sub.day || 'วันจันทร์');
    setInputStartTime(sub.startTime || '08:30');
    setInputEndTime(sub.endTime || '11:30');
    setInputRoom(sub.room || '');
  };

  const handleResetSubjectForm = () => {
    setEditingSubjectId(null);
    setInputSubjectCode('');
    setInputSubjectName('');
    setInputSec('');
    setInputDay('วันจันทร์');
    setInputStartTime('08:30');
    setInputEndTime('11:30');
    setInputRoom('');
  };

  // --- ฟังก์ชันถอนรายวิชา (ลบเอกสารวิชา + ลบรายวิชานั้นออกจากนักศึกษาทุกคน) ---
  const handleDeleteSubject = (subId) => {
    showConfirm(
      'ยืนยันการถอนรายวิชา',
      `คุณต้องการถอนวิชา/ลบวิชา [${subId}] ใช่หรือไม่? (นักศึกษาทุกคนในวิชานี้จะถูกปลดออก)`,
      async () => {
        // 1. ลบเอกสารวิชา
        await deleteDoc(doc(db, 'subjects', subId));

        // 2. ลบรหัสวิชานี้ออกจากตัวนักศึกษาทุกคนที่มีวิชานี้อยู่
        const studentsWithSub = students.filter(s => s.subjects && s.subjects.includes(subId));
        for (const std of studentsWithSub) {
          const updatedSubs = std.subjects.filter(s => s !== subId);
          await updateDoc(doc(db, 'students', std.id), {
            subjects: updatedSubs
          });
        }

        showAlert('สำเร็จ', `ถอนรายวิชา [${subId}] เรียบร้อยแล้ว`, 'success');
      }
    );
  };

  // --- ดาวน์โหลดไฟล์ Excel ตัวอย่าง ---
  const handleDownloadTemplate = () => {
    const templateData = [
      { 'id': '65121801', 'name': 'นายสมชาย ใจดี' },
      { 'id': '65121802', 'name': 'นางสาวจริญญา มณีรัตน์' },
      { 'id': '65121803', 'name': 'นางสาวปวริศา ใจเอิบ' }
    ];
    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'ตัวอย่างรายชื่อ');
    XLSX.writeFile(workbook, 'ตัวอย่างไฟล์รายชื่อนักศึกษา.xlsx');
  };

  // --- อัปโหลดไฟล์ Excel นำเข้าข้อมูลนักศึกษา ---
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const targetSub = excelTargetSubject || selectedSubject;
    if (!targetSub) {
      showAlert('กรุณาเลือกวิชา', 'กรุณาเลือกรายวิชาก่อนทำการนำเข้าไฟล์ Excel', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target.result;
        const workbook = XLSX.read(bstr, { type: 'binary' });
        const wsname = workbook.SheetNames[0];
        const ws = workbook.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);

        let count = 0;
        for (const row of data) {
          const stdId = String(row['id'] || row['รหัสนักศึกษา'] || row['รหัส'] || row['student_id'] || '').trim();
          const stdName = String(row['name'] || row['ชื่อ-นามสกุล'] || row['ชื่อ'] || '').trim();

          if (stdId && stdName) {
            const currentStd = students.find(s => s.id === stdId);
            let currentSubjects = currentStd ? (currentStd.subjects || []) : [];

            if (!currentSubjects.includes(targetSub)) {
              currentSubjects.push(targetSub);
            }

            await setDoc(doc(db, 'students', stdId), {
              name: stdName,
              subjects: currentSubjects
            }, { merge: true });
            count++;
          }
        }
        showAlert('นำเข้าสำเร็จ', `นำเข้ารายชื่อนักศึกษาในวิชา [${targetSub}] สำเร็จ ${count} คน`, 'success');
      } catch (err) {
        console.error(err);
        showAlert('ข้อผิดพลาด', 'อ่านไฟล์ Excel ไม่สำเร็จ กรุณาตรวจสอบรูปแบบไฟล์', 'error');
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleWeeklyCheckin = async (student, weekNum, currentStatus) => {
    if (!selectedSubject) return;

    const statusMap = {
      '-': 'มาเรียน',
      'มาเรียน': 'สาย',
      'สาย': 'ลา',
      'ลา': 'ขาด',
      'ขาด': 'มาเรียน'
    };

    const nextStatus = statusMap[currentStatus] || 'มาเรียน';
    const weekKey = `status_${selectedSubject}_week${weekNum}`;

    await updateDoc(doc(db, 'students', String(student.id).trim()), {
      [weekKey]: nextStatus
    });
  };

  const handleExportExcel = () => {
    if (!selectedSubject) return;
    const exportData = filteredStudents.map((std, idx) => {
      const rowData = {
        'ลำดับ': idx + 1,
        'รหัสนักศึกษา': std.id,
        'ชื่อ-นามสกุล': std.name,
      };

      for (let w = 1; w <= totalWeeks; w++) {
        const weekKey = `status_${selectedSubject}_week${w}`;
        rowData[`สัปดาห์ที่ ${w}`] = std[weekKey] || '-';
      }

      return rowData;
    });

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'เช็คชื่อสัปดาห์');
    XLSX.writeFile(workbook, `Checkin_${selectedSubject}_${totalWeeks}Weeks.xlsx`);
  };

  // ==========================================
  // 📱 1. หน้าสำหรับนักศึกษาสแกน QR Code เข้ามา
  // ==========================================
  if (studentSubjectParam) {
    const deviceFingerprint = getDeviceFingerprint();
    const localCheckedKey = `has_checked_${studentSubjectParam}_week${weekParam}`;
    const savedSuccessMsg = localStorage.getItem(localCheckedKey);

    const handleStudentSelfCheckin = async (e) => {
      e.preventDefault();
      if (!studentInputId.trim()) return;

      setIsSubmitting(true);
      setStudentStatusMsg(null);

      const stdId = studentInputId.trim();
      const weekKey = `status_${studentSubjectParam}_week${weekParam}`;
      const deviceDocId = `checkin_device_${studentSubjectParam}_week${weekParam}_${deviceFingerprint}`;

      // 1. ตรวจสอบว่าวิชานี้ยังมีอยู่ในระบบหรือไม่
      try {
        const subjectSnap = await getDoc(doc(db, 'subjects', studentSubjectParam));
        if (!subjectSnap.exists()) {
          setStudentStatusMsg({
            type: 'error',
            text: `❌ ไม่พบรายวิชา [${studentSubjectParam}] ในระบบ (วิชานี้อาจถูกถอนหรือลบไปแล้ว)`
          });
          setIsSubmitting(false);
          return;
        }
      } catch (err) {
        console.error(err);
      }

      // 2. ตรวจสอบอายุ QR Code (3 นาที)
      if (tokenParam) {
        const tokenTime = Number(tokenParam);
        const currentTime = Date.now();
        if (currentTime - tokenTime > 180000) {
          setStudentStatusMsg({
            type: 'error',
            text: '❌ QR Code นี้หมดอายุแล้ว กรุณาสแกนสดจากหน้าจออาจารย์ใหม่อีกครั้ง'
          });
          setIsSubmitting(false);
          return;
        }
      }

      try {
        // 3. ตรวจสอบจาก Firestore ว่าอุปกรณ์นี้เคยสแกนสัปดาห์นี้ไปแล้วหรือยัง
        const deviceRef = doc(db, 'checkin_devices', deviceDocId);
        const deviceSnap = await getDoc(deviceRef);

        if (deviceSnap.exists()) {
          const usedStdId = deviceSnap.data().studentId;
          setStudentStatusMsg({
            type: 'error',
            text: `⚠️ โทรศัพท์เครื่องนี้ถูกใช้เช็คชื่อให้รหัส [${usedStdId}] ในสัปดาห์ที่ ${weekParam} ไปแล้ว ไม่สามารถเช็คชื่อแทนกันได้`
          });
          setIsSubmitting(false);
          return;
        }

        // 4. ตรวจสอบรหัสนักศึกษาในฐานข้อมูล
        const studentDocRef = doc(db, 'students', stdId);
        const studentSnap = await getDoc(studentDocRef);

        if (!studentSnap.exists()) {
          setStudentStatusMsg({
            type: 'error',
            text: `❌ ไม่พบรหัสนักศึกษา [${stdId}] ในระบบ กรุณาติดต่ออาจารย์ผู้สอน`
          });
          setIsSubmitting(false);
          return;
        }

        const studentData = studentSnap.data();

        // ตรวจสอบว่านักศึกษาอยู่ในวิชานี้หรือไม่
        if (!studentData.subjects || !studentData.subjects.includes(studentSubjectParam)) {
          setStudentStatusMsg({
            type: 'error',
            text: `❌ รหัสนักศึกษา [${stdId}] ไม่ได้ลงทะเบียนในรายวิชานี้`
          });
          setIsSubmitting(false);
          return;
        }

        // 5. ตรวจสอบว่ารหัสนักศึกษานี้ เช็คชื่อสัปดาห์นี้ไปแล้วหรือยัง
        if (studentData[weekKey] === 'มาเรียน') {
          setStudentStatusMsg({
            type: 'error',
            text: `⚠️ รหัสนักศึกษา [${stdId}] ได้ทำการเช็คชื่อประจำสัปดาห์ที่ ${weekParam} เรียบร้อยแล้ว`
          });
          setIsSubmitting(false);
          return;
        }

        // 6. บันทึกเช็คชื่อ + ล็อค Device Fingerprint
        await updateDoc(studentDocRef, {
          [weekKey]: 'มาเรียน'
        });

        await setDoc(deviceRef, {
          studentId: stdId,
          subjectId: studentSubjectParam,
          week: weekParam,
          fingerprint: deviceFingerprint,
          timestamp: new Date()
        });

        const successText = `✅ เช็คชื่อสำเร็จ! [${stdId}] สัปดาห์ที่ ${weekParam} (มาเรียน)`;
        localStorage.setItem(localCheckedKey, successText);

        setStudentStatusMsg({
          type: 'success',
          text: successText
        });
      } catch (err) {
        console.error(err);
        setStudentStatusMsg({
          type: 'error',
          text: '❌ เกิดข้อผิดพลาดในการบันทึกข้อมูล กรุณาลองใหม่อีกครั้ง'
        });
      } finally {
        setIsSubmitting(false);
      }
    };

    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9', fontFamily: "'Sarabun', sans-serif", padding: '16px' }}>
        <div style={{ backgroundColor: '#fff', padding: '28px', borderRadius: '12px', width: '100%', maxWidth: '400px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', textAlign: 'center' }}>
          <div style={{ backgroundColor: '#2563eb', color: '#fff', padding: '12px', borderRadius: '8px', marginBottom: '20px' }}>
            <h2 style={{ margin: 0, fontSize: '20px' }}>📝 เช็คชื่อเข้าเรียน</h2>
          </div>

          <div style={{ backgroundColor: '#f8fafc', padding: '12px', borderRadius: '8px', marginBottom: '20px', textAlign: 'left', fontSize: '14px' }}>
            <p style={{ margin: '0 0 4px 0', color: '#475569' }}>วิชา: <strong style={{ color: '#0f172a' }}>{studentSubjectParam}</strong></p>
            <p style={{ margin: 0, color: '#475569' }}>ประจำสัปดาห์ที่: <strong style={{ color: '#2563eb' }}>{weekParam}</strong></p>
          </div>

          {savedSuccessMsg || studentStatusMsg ? (
            <div style={{ 
              padding: '16px', 
              backgroundColor: (savedSuccessMsg || studentStatusMsg?.type === 'success') ? '#dcfce7' : '#fee2e2', 
              color: (savedSuccessMsg || studentStatusMsg?.type === 'success') ? '#15803d' : '#b91c1c', 
              borderRadius: '8px', 
              fontWeight: 'bold',
              lineHeight: '1.5'
            }}>
              {savedSuccessMsg || studentStatusMsg.text}
            </div>
          ) : (
            <form onSubmit={handleStudentSelfCheckin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', textAlign: 'left', marginBottom: '6px', fontWeight: 'bold', color: '#334155', fontSize: '14px' }}>
                  รหัสนักศึกษา:
                </label>
                <input
                  type="text"
                  placeholder="เช่น 65121802"
                  value={studentInputId}
                  onChange={(e) => setStudentInputId(e.target.value)}
                  style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '18px', textAlign: 'center', boxSizing: 'border-box' }}
                  required
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                style={{ padding: '12px', backgroundColor: isSubmitting ? '#94a3b8' : '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '16px', fontWeight: 'bold', cursor: isSubmitting ? 'not-allowed' : 'pointer' }}
              >
                {isSubmitting ? 'กำลังบันทึก...' : 'บันทึกการเช็คชื่อ'}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // ==========================================
  // 💻 2. หน้าสำหรับอาจารย์ผู้สอน (ระบบหลัก)
  // ==========================================
  if (!currentUser) {
    return <Login onLoginSuccess={(teacher) => setCurrentUser(teacher)} />;
  }

  // แสดงเฉพาะนักศึกษาที่มีวิชาตรงกับ selectedSubject เท่านั้น
  const filteredStudents = students.filter(std => {
    if (!selectedSubject) return false;
    return std.subjects && std.subjects.includes(selectedSubject);
  });

  const weeksArray = Array.from({ length: totalWeeks }, (_, i) => i + 1);
  const currentBaseUrl = window.location.origin;
  
  const qrCheckinUrl = selectedSubject 
    ? `${currentBaseUrl}?subject=${encodeURIComponent(selectedSubject)}&w=${selectedWeek}&t=${qrToken}`
    : '';

  return (
    <div style={{ width: '100%', minHeight: '100vh', backgroundColor: '#e2e8f0', fontFamily: "'Sarabun', sans-serif", margin: 0, padding: 0 }}>
      {/* Keyframe Animations */}
      <style>{`
        @keyframes popIn {
          0% { transform: scale(0.6); opacity: 0; }
          70% { transform: scale(1.05); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes checkmarkAnim {
          0% { stroke-dashoffset: 100; }
          100% { stroke-dashoffset: 0; }
        }
        .modal-animated-box {
          animation: popIn 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
        }
        .checkmark-path {
          stroke-dasharray: 100;
          stroke-dashoffset: 100;
          animation: checkmarkAnim 0.6s ease-in-out 0.2s forwards;
        }
      `}</style>

      {/* Header - อัปเดตชื่อระบบเป็น มหาวิทยาลัยราชภัฏเชียงใหม่ */}
      <header style={{ width: '100%', backgroundColor: '#f59e0b', color: '#ffffff', padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ backgroundColor: '#ffffff', color: '#0284c7', fontWeight: 'bold', padding: '6px 12px', borderRadius: '50%' }}>CMRU</div>
          <h1 style={{ margin: 0, fontSize: '20px' }}>ระบบเช็คชื่อนักศึกษาของมหาวิทยาลัยราชภัฏเชียงใหม่</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span>👤 {currentUser.name}</span>
          <button
            onClick={() => setCurrentUser(null)}
            style={{ padding: '6px 12px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            ออกจากระบบ
          </button>
        </div>
      </header>

      <div style={{ display: 'flex', minHeight: 'calc(100vh - 65px)', width: '100%' }}>
        {/* Sidebar */}
        <aside style={{ width: '220px', minWidth: '220px', backgroundColor: '#ffffff', padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px', borderRight: '1px solid #cbd5e1', boxSizing: 'border-box' }}>
          <button
            onClick={() => setActiveTab('checkin')}
            style={{ padding: '10px 14px', backgroundColor: activeTab === 'checkin' ? '#2563eb' : 'transparent', color: activeTab === 'checkin' ? '#fff' : '#334155', border: 'none', borderRadius: '6px', textAlign: 'left', cursor: 'pointer', fontWeight: 'bold' }}
          >
            📝 ตารางเช็คชื่อรายสัปดาห์
          </button>
          <button
            onClick={() => setActiveTab('management')}
            style={{ padding: '10px 14px', backgroundColor: activeTab === 'management' ? '#2563eb' : 'transparent', color: activeTab === 'management' ? '#fff' : '#334155', border: 'none', borderRadius: '6px', textAlign: 'left', cursor: 'pointer', fontWeight: 'bold' }}
          >
            📚 จัดการวิชาและนักศึกษา
          </button>
        </aside>

        {/* Main Content Area */}
        <main style={{ flex: 1, padding: '24px', overflowX: 'auto', boxSizing: 'border-box', width: 'calc(100% - 220px)' }}>
          {/* TAB 1: ตารางเช็คชื่อ */}
          {activeTab === 'checkin' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', backgroundColor: '#fff', padding: '16px', borderRadius: '8px', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ fontWeight: 'bold' }}>เลือกวิชา:</label>
                  <select
                    value={selectedSubject}
                    onChange={(e) => setSelectedSubject(e.target.value)}
                    style={{ padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  >
                    {subjects.length === 0 ? (
                      <option value="">-- ยังไม่มีวิชา --</option>
                    ) : (
                      subjects.map(s => (
                        <option key={s.id} value={s.id}>[{s.id}] {s.name} (Sec {s.sec || '1'})</option>
                      ))
                    )}
                  </select>

                  <label style={{ fontWeight: 'bold' }}>สัปดาห์ที่เปิดสแกน:</label>
                  <select
                    value={selectedWeek}
                    onChange={(e) => setSelectedWeek(Number(e.target.value))}
                    style={{ padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  >
                    {weeksArray.map(w => (
                      <option key={w} value={w}>สัปดาห์ที่ {w}</option>
                    ))}
                  </select>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#f1f5f9', padding: '4px 12px', borderRadius: '6px' }}>
                    <span style={{ fontWeight: 'bold', fontSize: '14px' }}>จำนวนสัปดาห์ทั้งหมด: {totalWeeks}</span>
                    <button onClick={() => setTotalWeeks(prev => Math.max(1, prev - 1))} style={{ padding: '2px 8px', backgroundColor: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>-</button>
                    <button onClick={() => setTotalWeeks(prev => prev + 1)} style={{ padding: '2px 8px', backgroundColor: '#10b981', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>+</button>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => setShowQuickAdd(!showQuickAdd)} style={{ backgroundColor: '#0284c7', color: '#fff', border: 'none', padding: '10px 14px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
                    {showQuickAdd ? '✖ ซ่อนเมนูเพิ่มนศ.' : '➕ เพิ่มนักศึกษาด่วน'}
                  </button>
                  <button onClick={handleExportExcel} style={{ backgroundColor: '#16a34a', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
                    📊 ส่งออก Excel
                  </button>
                </div>
              </div>

              {/* กล่องเพิ่มนักศึกษาด่วนในหน้าตาราง */}
              {showQuickAdd && (
                <div style={{ backgroundColor: '#f0f9ff', padding: '16px', borderRadius: '8px', border: '1px solid #bae6fd', marginBottom: '16px' }}>
                  <h4 style={{ margin: '0 0 12px 0', color: '#0369a1' }}>➕ เพิ่มนักศึกษาเข้าวิชา [{selectedSubject}]</h4>
                  <form onSubmit={handleQuickAddStudent} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <input
                      type="text"
                      placeholder="รหัสนักศึกษา (เช่น 65121804)"
                      value={quickStdId}
                      onChange={(e) => setQuickStdId(e.target.value)}
                      style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', minWidth: '180px' }}
                      required
                    />
                    <input
                      type="text"
                      placeholder="ชื่อ-นามสกุล นักศึกษา"
                      value={quickStdName}
                      onChange={(e) => setQuickStdName(e.target.value)}
                      style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', flex: 1, minWidth: '220px' }}
                      required
                    />
                    <button type="submit" style={{ padding: '8px 16px', backgroundColor: '#0284c7', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
                      บันทึกเพิ่มนศ.
                    </button>
                  </form>
                </div>
              )}

              {/* Dynamic Anti-Cheat QR Code */}
              {selectedSubject && (
                <div style={{ backgroundColor: '#fff', padding: '16px', borderRadius: '8px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '20px' }}>
                  <div style={{ textAlign: 'center' }}>
                    <QRCodeSVG value={qrCheckinUrl} size={110} />
                    <div style={{ marginTop: '6px', fontSize: '12px', fontWeight: 'bold', color: '#dc2626' }}>
                      🔄 รีเฟรชใน: {countdown} วิ
                    </div>
                  </div>
                  <div>
                    <h3 style={{ margin: '0 0 6px 0', color: '#1e293b' }}>สแกน QR Code เพื่อเช็คชื่อ (สัปดาห์ที่ {selectedWeek})</h3>
                    {currentBaseUrl.includes('localhost') && (
                      <p style={{ margin: '0 0 6px 0', fontSize: '13px', color: '#d97706', fontWeight: 'bold', backgroundColor: '#fef3c7', padding: '4px 8px', borderRadius: '4px' }}>
                        ⚠️ คุณกำลังรันแบบ Localhost มือถือสแกนไม่ได้! กรุณาส่งเว็บขึ้นออนไลน์ด้วย <code style={{ color: '#b45309' }}>npx firebase deploy</code>
                      </p>
                    )}
                    <p style={{ margin: '0 0 6px 0', fontSize: '13px', color: '#ef4444', fontWeight: 'bold' }}>
                      ⚠️ QR Code เปลี่ยนรหัสสดทุก 10 วินาที | 1 เครื่องสแกนได้ 1 ครั้ง
                    </p>
                    <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
                      ลิงก์เช็คชื่อ: <a href={qrCheckinUrl} target="_blank" rel="noreferrer">{qrCheckinUrl}</a>
                    </p>
                  </div>
                </div>
              )}

              {/* ตารางเช็คชื่อตามสัปดาห์ */}
              <div style={{ backgroundColor: '#fff', borderRadius: '8px', overflowX: 'auto', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', width: '100%' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '1100px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f1f5f9', textAlign: 'center', borderBottom: '2px solid #e2e8f0' }}>
                      <th style={{ padding: '10px', width: '45px' }}>ลำดับ</th>
                      <th style={{ padding: '10px', width: '100px' }}>รหัส</th>
                      <th style={{ padding: '10px', width: '170px', textAlign: 'left' }}>ชื่อ-นามสกุล</th>
                      {weeksArray.map(w => (
                        <th key={w} style={{ padding: '8px', borderLeft: '1px solid #cbd5e1', minWidth: '50px', backgroundColor: w === selectedWeek ? '#e0f2fe' : 'transparent' }}>
                          สัปดาห์ {w}
                        </th>
                      ))}
                      <th style={{ padding: '10px', width: '60px', borderLeft: '2px solid #e2e8f0' }}>จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStudents.length === 0 ? (
                      <tr><td colSpan={4 + totalWeeks} style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>ไม่พบรายชื่อนักศึกษาในวิชานี้</td></tr>
                    ) : (
                      filteredStudents.map((std, idx) => (
                        <tr key={std.id} style={{ borderBottom: '1px solid #f1f5f9', textAlign: 'center' }}>
                          <td style={{ padding: '10px' }}>{idx + 1}</td>
                          <td style={{ padding: '10px', fontWeight: 'bold' }}>{std.id}</td>
                          <td style={{ padding: '10px', textAlign: 'left' }}>{std.name}</td>
                          {weeksArray.map(w => {
                            const weekKey = `status_${selectedSubject}_week${w}`;
                            const status = std[weekKey] || '-';
                            return (
                              <td 
                                key={w} 
                                onClick={() => handleWeeklyCheckin(std, w, status)}
                                style={{ 
                                  padding: '6px', 
                                  borderLeft: '1px solid #f1f5f9',
                                  cursor: 'pointer',
                                  userSelect: 'none',
                                  fontWeight: 'bold',
                                  fontSize: '12px',
                                  backgroundColor: status === 'มาเรียน' ? '#dcfce7' : status === 'สาย' ? '#fef9c3' : status === 'ลา' ? '#e0f2fe' : status === 'ขาด' ? '#fee2e2' : 'transparent',
                                  color: status === 'มาเรียน' ? '#15803d' : status === 'สาย' ? '#a16207' : status === 'ลา' ? '#0369a1' : status === 'ขาด' ? '#b91c1c' : '#94a3b8'
                                }}
                              >
                                {status}
                              </td>
                            );
                          })}
                          <td style={{ padding: '6px', borderLeft: '2px solid #e2e8f0' }}>
                            <button
                              onClick={() => handleRemoveStudentFromSubject(std.id)}
                              style={{ padding: '4px 8px', backgroundColor: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}
                              title="ลบนักศึกษาออกจากวิชานี้"
                            >
                              🗑️ ลบ
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: จัดการวิชาและนักศึกษา */}
          {activeTab === 'management' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'start' }}>
              
              {/* คอลัมน์ซ้าย: ฟอร์มเพิ่ม/แก้ไข ข้อมูลรายวิชา */}
              <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '8px', border: '1px solid #cbd5e1', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <h3 style={{ margin: '0 0 16px 0', color: '#0284c7', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  ✏️ {editingSubjectId ? 'แก้ไขข้อมูลรายวิชา' : 'เพิ่มข้อมูลรายวิชา'}
                </h3>

                <form onSubmit={handleSaveSubject} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 'bold', color: '#334155', textAlign: 'center' }}>รหัสวิชา:</label>
                    <input
                      type="text"
                      placeholder="เช่น GEN 1301-62"
                      value={inputSubjectCode}
                      onChange={(e) => setInputSubjectCode(e.target.value)}
                      disabled={!!editingSubjectId}
                      style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #334155', backgroundColor: '#334155', color: '#fff', fontSize: '14px', boxSizing: 'border-box' }}
                      required
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 'bold', color: '#334155', textAlign: 'center' }}>ชื่อรายวิชา:</label>
                    <input
                      type="text"
                      placeholder="เช่น ความเป็นราชภัฏเชียงใหม่"
                      value={inputSubjectName}
                      onChange={(e) => setInputSubjectName(e.target.value)}
                      style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #334155', backgroundColor: '#334155', color: '#fff', fontSize: '14px', boxSizing: 'border-box' }}
                      required
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 'bold', color: '#334155', textAlign: 'center' }}>Section / หมู่เรียน:</label>
                    <input
                      type="text"
                      placeholder="เช่น 57"
                      value={inputSec}
                      onChange={(e) => setInputSec(e.target.value)}
                      style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #334155', backgroundColor: '#334155', color: '#fff', fontSize: '14px', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 'bold', color: '#334155', textAlign: 'center' }}>วันที่มีเรียน:</label>
                    <select
                      value={inputDay}
                      onChange={(e) => setInputDay(e.target.value)}
                      style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #334155', backgroundColor: '#334155', color: '#fff', fontSize: '14px', boxSizing: 'border-box' }}
                    >
                      <option value="วันจันทร์">วันจันทร์</option>
                      <option value="วันอังคาร">วันอังคาร</option>
                      <option value="วันพุธ">วันพุธ</option>
                      <option value="วันพฤหัสบดี">วันพฤหัสบดี</option>
                      <option value="วันศุกร์">วันศุกร์</option>
                      <option value="วันเสาร์">วันเสาร์</option>
                      <option value="วันอาทิตย์">วันอาทิตย์</option>
                    </select>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 'bold', color: '#334155', textAlign: 'center' }}>เวลาเริ่ม:</label>
                      <input
                        type="time"
                        value={inputStartTime}
                        onChange={(e) => setInputStartTime(e.target.value)}
                        style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #334155', backgroundColor: '#334155', color: '#fff', fontSize: '14px', boxSizing: 'border-box' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 'bold', color: '#334155', textAlign: 'center' }}>เวลาสิ้นสุด:</label>
                      <input
                        type="time"
                        value={inputEndTime}
                        onChange={(e) => setInputEndTime(e.target.value)}
                        style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #334155', backgroundColor: '#334155', color: '#fff', fontSize: '14px', boxSizing: 'border-box' }}
                      />
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 'bold', color: '#334155', textAlign: 'center' }}>ห้องเรียน:</label>
                    <input
                      type="text"
                      placeholder="เช่น A301"
                      value={inputRoom}
                      onChange={(e) => setInputRoom(e.target.value)}
                      style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #334155', backgroundColor: '#334155', color: '#fff', fontSize: '14px', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <button
                      type="submit"
                      style={{ flex: 1, padding: '12px', backgroundColor: '#0284c7', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px' }}
                    >
                      {editingSubjectId ? 'บันทึกการแก้ไข' : 'บันทึกรายวิชา'}
                    </button>
                    {editingSubjectId && (
                      <button
                        type="button"
                        onClick={handleResetSubjectForm}
                        style={{ padding: '12px 16px', backgroundColor: '#64748b', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px' }}
                      >
                        ยกเลิก
                      </button>
                    )}
                  </div>
                </form>
              </div>

              {/* คอลัมน์ขวา: นำเข้า Excel + รายชื่อวิชาทั้งหมดในระบบ */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                
                {/* กล่องนำเข้าข้อมูล Excel */}
                <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '8px', border: '1px solid #cbd5e1', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                  <h4 style={{ margin: '0 0 14px 0', color: '#16a34a', fontSize: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    📌 นำเข้าข้อมูลรายชื่อนักศึกษา (Excel)
                  </h4>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <button
                      type="button"
                      onClick={handleDownloadTemplate}
                      style={{ padding: '10px', backgroundColor: '#475569', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', width: 'fit-content' }}
                    >
                      📄 โหลดไฟล์ตัวอย่าง (.xlsx)
                    </button>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#334155' }}>เลือกวิชาที่จะนำเข้า:</span>
                      <select
                        value={excelTargetSubject}
                        onChange={(e) => setExcelTargetSubject(e.target.value)}
                        style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#fff', fontSize: '13px' }}
                      >
                        {subjects.map(s => (
                          <option key={s.id} value={s.id}>[{s.id}] {s.name}</option>
                        ))}
                      </select>
                    </div>

                    <input
                      type="file"
                      accept=".xlsx, .xls"
                      onChange={handleFileUpload}
                      style={{ fontSize: '13px' }}
                    />
                  </div>
                </div>

                {/* รายวิชาทั้งหมดในระบบ */}
                <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '8px', border: '1px solid #cbd5e1', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                  <h4 style={{ margin: '0 0 14px 0', color: '#334155', fontSize: '16px' }}>
                    📚 รายวิชาทั้งหมดในระบบ
                  </h4>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '400px', overflowY: 'auto' }}>
                    {subjects.length === 0 ? (
                      <p style={{ color: '#94a3b8', fontSize: '14px', textAlign: 'center', margin: '16px 0' }}>ยังไม่มีวิชาในระบบ</p>
                    ) : (
                      subjects.map(sub => (
                        <div key={sub.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', backgroundColor: '#f8fafc' }}>
                          <div>
                            <span style={{ fontWeight: 'bold', color: '#0284c7', fontSize: '15px' }}>[{sub.id}] {sub.name}</span>
                            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                              Sec: {sub.sec || '1'} | {sub.day || ''} {sub.startTime ? `${sub.startTime}-${sub.endTime}` : ''} | ห้อง {sub.room || '-'}
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              onClick={() => handleEditSubject(sub)}
                              style={{ padding: '6px 12px', backgroundColor: '#f59e0b', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}
                            >
                              แก้ไข
                            </button>
                            <button
                              onClick={() => handleDeleteSubject(sub.id)}
                              style={{ padding: '6px 12px', backgroundColor: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}
                            >
                              ถอนวิชา
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

              </div>

            </div>
          )}
        </main>
      </div>

      {/* Animated Alert Modal */}
      {customAlert.isOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div className="modal-animated-box" style={{ backgroundColor: '#fff', padding: '28px 36px', borderRadius: '16px', width: '340px', textAlign: 'center', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)' }}>
            
            <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'center' }}>
              {customAlert.type === 'error' ? (
                <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </div>
              ) : (
                <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" className="checkmark-path"></polyline>
                  </svg>
                </div>
              )}
            </div>

            <h3 style={{ margin: '0 0 8px 0', color: '#0f172a', fontSize: '20px', fontWeight: 'bold' }}>{customAlert.title}</h3>
            <p style={{ margin: '0 0 20px 0', color: '#475569', fontSize: '14px', lineHeight: '1.5' }}>{customAlert.message}</p>
            
            <button
              onClick={() => setCustomAlert({ ...customAlert, isOpen: false })}
              style={{
                width: '100%',
                padding: '10px 0',
                backgroundColor: customAlert.type === 'error' ? '#ef4444' : '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '15px'
              }}
            >
              ตกลง
            </button>
          </div>
        </div>
      )}

      {/* Modern Animated Confirm Modal */}
      {confirmDialog.isOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
          <div className="modal-animated-box" style={{ backgroundColor: '#fff', padding: '28px 32px', borderRadius: '16px', width: '360px', textAlign: 'center', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            
            <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'center' }}>
              <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                  <line x1="12" y1="9" x2="12" y2="13"></line>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
              </div>
            </div>

            <h3 style={{ margin: '0 0 8px 0', color: '#0f172a', fontSize: '19px', fontWeight: 'bold' }}>{confirmDialog.title}</h3>
            <p style={{ margin: '0 0 24px 0', color: '#475569', fontSize: '14px', lineHeight: '1.5' }}>{confirmDialog.message}</p>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => setConfirmDialog((prev) => ({ ...prev, isOpen: false }))}
                style={{ flex: 1, padding: '10px 0', backgroundColor: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}
              >
                ยกเลิก
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                style={{ flex: 1, padding: '10px 0', backgroundColor: '#ef4444', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px', boxShadow: '0 4px 6px -1px rgba(239, 68, 68, 0.2)' }}
              >
                ยืนยันการลบ
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}

export default App;
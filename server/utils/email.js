/* eslint-disable no-console -- email transport status logging and unconfigured fallback */
const { getSharedResolver } = require('../infrastructure/configResolver');

let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch (error) {
  console.warn('⚠️  nodemailer not found. Email functionality will be disabled.');
  console.warn('   Run: cd server && npm install nodemailer');
  nodemailer = null;
}

let transporter = null;

// EMAIL_* are T2 (hot): read the effective values (env → DB → default) via the
// shared resolver so DB-sourced email config is honored. The transporter itself
// is still built once per process; a restart rebuilds it with fresh values.
function readEmailConfig() {
  const resolver = getSharedResolver();
  return {
    host: resolver.getConfigSync('EMAIL_HOST'),
    port: parseInt(resolver.getConfigSync('EMAIL_PORT'), 10) || 587,
    secure: resolver.getConfigSync('EMAIL_SECURE') === 'true',
    user: resolver.getConfigSync('EMAIL_USER'),
    password: resolver.getConfigSync('EMAIL_PASSWORD'),
    fromName: resolver.getConfigSync('EMAIL_FROM_NAME'),
  };
}

function initEmailTransporter() {
  if (!nodemailer) {
    console.warn('Email configuration skipped: nodemailer not available.');
    return null;
  }

  const { host, port, secure, user, password } = readEmailConfig();

  if (!host || !user || !password) {
    console.warn('Email configuration not found. Email functionality will be disabled.');
    return null;
  }

  try {
    // nodemailer uses createTransport (not createTransporter)
    transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass: password,
      },
    });

    console.log('✅ Email transporter initialized');
    return transporter;
  } catch (error) {
    console.error('Failed to initialize email transporter:', error.message);
    console.error(error.stack);
    return null;
  }
}

async function sendEmail(to, subject, htmlContent) {
  if (!transporter && nodemailer) {
    transporter = initEmailTransporter();
  }

  if (!transporter) {
    console.log('📧 Email not configured. Logging to console instead:');
    console.log(`   To: ${to}`);
    console.log(`   Subject: ${subject}`);
    console.log(`   Body: ${htmlContent.substring(0, 100)}...`);
    return { success: false, error: 'Email not configured' };
  }

  try {
    const { fromName, user } = readEmailConfig();
    const info = await transporter.sendMail({
      from: `"${fromName || 'WebDAV EasyAccess'}" <${user}>`,
      to,
      subject,
      html: htmlContent,
    });

    console.log('✅ Email sent: ' + info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Email send error:', error);
    return { success: false, error: error.message };
  }
}

async function sendRegistrationPendingEmail(email, username) {
  const subject = '회원가입 승인 대기 안내';
  const html = `
    <h2>회원가입이 접수되었습니다</h2>
    <p>안녕하세요, <strong>${username}</strong>님!</p>
    <p>WebDAV EasyAccess 서비스에 가입 신청해 주셔서 감사합니다.</p>
    <p>현재 관리자의 승인 대기 중이며, 승인 완료 시 다시 이메일로 안내해 드리겠습니다.</p>
    <br>
    <p>감사합니다.</p>
    <p><small>WebDAV EasyAccess</small></p>
  `;

  return await sendEmail(email, subject, html);
}

async function sendApprovalEmail(email, username) {
  const subject = '회원가입이 승인되었습니다';
  const html = `
    <h2>회원가입 승인 완료</h2>
    <p>안녕하세요, <strong>${username}</strong>님!</p>
    <p>WebDAV EasyAccess 서비스 가입이 승인되었습니다.</p>
    <p>이제 로그인하여 서비스를 이용하실 수 있습니다.</p>
    <p>귀하의 전용 폴더 <code>/${username}</code>가 생성되었으며, 해당 폴더에 파일을 업로드하고 관리할 수 있습니다.</p>
    <br>
    <p>서비스를 이용해 주셔서 감사합니다.</p>
    <p><small>WebDAV EasyAccess</small></p>
  `;

  return await sendEmail(email, subject, html);
}

async function sendRejectionEmail(email, username) {
  const subject = '회원가입 신청이 거절되었습니다';
  const html = `
    <h2>회원가입 거절 안내</h2>
    <p>안녕하세요, <strong>${username}</strong>님!</p>
    <p>죄송합니다. 귀하의 WebDAV EasyAccess 서비스 가입 신청이 거절되었습니다.</p>
    <p>자세한 사항은 관리자에게 문의해 주시기 바랍니다.</p>
    <br>
    <p><small>WebDAV EasyAccess</small></p>
  `;

  return await sendEmail(email, subject, html);
}

function isEmailEnabled() {
  if (!nodemailer) {
    return false;
  }

  const { host, user, password } = readEmailConfig();
  return !!(host && user && password);
}

module.exports = {
  initEmailTransporter,
  sendEmail,
  sendRegistrationPendingEmail,
  sendApprovalEmail,
  sendRejectionEmail,
  isEmailEnabled,
};

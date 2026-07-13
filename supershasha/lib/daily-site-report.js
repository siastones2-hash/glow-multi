/**
 * 멀티 사이트 일일 요약 → 슈퍼관리자 텔레그램 발송
 * server.js 에서 23:50 KST 스케줄로 호출
 */

const EXCLUDE_ORDER_STATUSES = `status NOT IN ('cancelled','canceled','failed','refunded','partial_refunded')`;

function kstDateString(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }); // YYYY-MM-DD
}

function formatKrw(n) {
  const v = Math.round(parseFloat(n) || 0);
  return '₩' + v.toLocaleString('ko-KR');
}

/**
 * @param {Function} query - server.js 의 query()
 * @param {Function} getGlobalSetting
 * @param {Function} setGlobalSetting
 * @param {Function} sendTelegramToSuper
 */
async function buildAndSendDailySiteReport(query, getGlobalSetting, setGlobalSetting, sendTelegramToSuper) {
  const reportDateKst = kstDateString();
  const lastSent = await getGlobalSetting('daily_report_last_sent');
  if (lastSent === reportDateKst) {
    console.log('📊 일일 리포트: 오늘 이미 발송됨 (' + reportDateKst + ')');
    return { skipped: true, reason: 'already_sent' };
  }

  const sitesR = await query(`SELECT id, name, domain FROM sites WHERE active=1 ORDER BY name`);
  const lines = [
    '📊 <b>GLOW 일일 요약</b>',
    `📅 ${reportDateKst} (KST)`,
    '',
  ];

  let totalRevenue = 0;
  let totalNewUsers = 0;

  for (const site of sitesR.rows) {
    const revR = await query(
      `
      SELECT COALESCE(SUM(charge), 0) AS revenue, COUNT(*)::int AS orders
      FROM orders
      WHERE site_id = $1
        AND ${EXCLUDE_ORDER_STATUSES}
        -- created 컬럼은 TIMESTAMP(타임존 없음)이라 UTC 기준으로 저장될 수 있음.
        -- UTC로 해석 후 KST로 변환해 날짜 비교해야 누락이 없음.
        AND ((created AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')::date = $2::date
      `,
      [site.id, reportDateKst]
    );
    const userR = await query(
      `
      SELECT COUNT(*)::int AS c
      FROM users
      WHERE site_id = $1
        AND role = 'user'
        AND ((joined AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')::date = $2::date
      `,
      [site.id, reportDateKst]
    );

    const revenue = parseFloat(revR.rows[0].revenue) || 0;
    const orders = parseInt(revR.rows[0].orders, 10) || 0;
    const newUsers = parseInt(userR.rows[0].c, 10) || 0;
    totalRevenue += revenue;
    totalNewUsers += newUsers;

    lines.push(`🏢 <b>${site.name}</b> (${site.domain || site.id})`);
    lines.push(`   💰 당일 매출: ${formatKrw(revenue)} (${orders}건)`);
    lines.push(`   👤 신규 가입: ${newUsers}명`);
    lines.push('');
  }

  lines.push('────────────');
  lines.push(`💰 <b>전체 당일 매출</b>: ${formatKrw(totalRevenue)}`);
  lines.push(`👤 <b>전체 신규 가입</b>: ${totalNewUsers}명`);

  const message = lines.join('\n');
  const sent = await sendTelegramToSuper(message);
  if (sent) {
    await setGlobalSetting('daily_report_last_sent', reportDateKst);
    console.log('✅ 일일 텔레그램 리포트 발송:', reportDateKst);
  } else {
    console.log('⚠️ 일일 리포트: 텔레그램 미설정 또는 발송 실패 (tg_token / tg_chat 확인)');
  }
  return { ok: sent, date: reportDateKst, message };
}

/**
 * 23:50 KST 에 맞춰 1분마다 체크 (Render UTC 환경 대응)
 */
function startDailyReportScheduler(query, getGlobalSetting, setGlobalSetting, sendTelegramToSuper) {
  const tick = async () => {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Seoul',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(new Date());
      const hour = parseInt(parts.find((p) => p.type === 'hour').value, 10);
      const minute = parseInt(parts.find((p) => p.type === 'minute').value, 10);
      if (hour === 23 && minute === 50) {
        await buildAndSendDailySiteReport(query, getGlobalSetting, setGlobalSetting, sendTelegramToSuper);
      }
    } catch (e) {
      console.log('일일 리포트 스케줄 오류:', e.message);
    }
  };

  setInterval(tick, 60 * 1000);
  console.log('📅 일일 텔레그램 리포트 스케줄러 등록 (매일 23:50 KST)');
}

module.exports = {
  buildAndSendDailySiteReport,
  startDailyReportScheduler,
  kstDateString,
};

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

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 텔레그램 HTML — 섹션 사이 빈 줄(칸) 확보 */
function gap(lines, n = 1) {
  for (let i = 0; i < n; i++) lines.push('');
}

/**
 * @param {Array<{id,name,domain,revenue,orders,newUsers}>} stats
 * @param {string} reportDateKst
 */
function formatDailyReportMessage(stats, reportDateKst) {
  const totalRevenue = stats.reduce((s, x) => s + x.revenue, 0);
  const totalOrders = stats.reduce((s, x) => s + x.orders, 0);
  const totalNewUsers = stats.reduce((s, x) => s + x.newUsers, 0);
  const active = stats.filter((x) => x.orders > 0 || x.newUsers > 0);
  const quiet = stats.filter((x) => x.orders === 0 && x.newUsers === 0);

  active.sort((a, b) => b.revenue - a.revenue || b.newUsers - a.newUsers || a.name.localeCompare(b.name, 'ko'));

  const lines = [];

  lines.push(`📊 <b>일일 요약</b>`);
  lines.push(`📅 ${reportDateKst}`);
  gap(lines, 2);

  lines.push(`<b>── 전체 ──</b>`);
  gap(lines);
  lines.push(`💰 매출　　<b>${formatKrw(totalRevenue)}</b>`);
  lines.push(`📦 주문　　<b>${totalOrders}건</b>`);
  lines.push(`👤 신규　　<b>${totalNewUsers}명</b>`);
  lines.push(`🏢 활동　　<b>${active.length}곳</b> / ${stats.length}곳`);
  gap(lines, 2);

  if (active.length === 0) {
    lines.push('📭 오늘 매출·신규가입 없음');
  } else {
    lines.push(`<b>── 활동 사이트 ${active.length}곳 ──</b>`);
    gap(lines, 2);

    active.forEach((s, idx) => {
      const domain = s.domain && s.domain !== s.id ? s.domain : '';
      lines.push(`▸ <b>${escHtml(s.name)}</b>`);
      if (domain) lines.push(`　<i>${escHtml(domain)}</i>`);
      gap(lines);
      if (s.revenue > 0 || s.orders > 0) {
        lines.push(`　💰 ${formatKrw(s.revenue)}　·　${s.orders}건`);
      } else {
        lines.push(`　💰 —`);
      }
      lines.push(`　👤 신규 +${s.newUsers}명`);
      if (idx < active.length - 1) gap(lines, 2);
    });
  }

  if (quiet.length > 0) {
    gap(lines, 2);
    lines.push(`<b>── 활동 없음 ──</b>`);
    gap(lines);
    if (quiet.length <= 6) {
      quiet.forEach((s) => lines.push(`💤 ${escHtml(s.name)}`));
    } else {
      lines.push(`💤 ${quiet.length}곳 (생략)`);
    }
  }

  return lines.join('\n');
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
  const stats = [];

  for (const site of sitesR.rows) {
    const revR = await query(
      `
      SELECT COALESCE(SUM(charge), 0) AS revenue, COUNT(*)::int AS orders
      FROM orders
      WHERE site_id = $1
        AND ${EXCLUDE_ORDER_STATUSES}
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

    stats.push({
      id: site.id,
      name: site.name || site.id,
      domain: site.domain || site.id,
      revenue: parseFloat(revR.rows[0].revenue) || 0,
      orders: parseInt(revR.rows[0].orders, 10) || 0,
      newUsers: parseInt(userR.rows[0].c, 10) || 0,
    });
  }

  const active = stats.filter((x) => x.orders > 0 || x.newUsers > 0);
  const message = formatDailyReportMessage(stats, reportDateKst);
  const sent = await sendTelegramToSuper(message);
  if (sent) {
    await setGlobalSetting('daily_report_last_sent', reportDateKst);
    console.log('✅ 일일 텔레그램 리포트 발송:', reportDateKst);
  } else {
    console.log('⚠️ 일일 리포트: 텔레그램 미설정 또는 발송 실패 (tg_token / tg_chat 확인)');
  }
  return { ok: sent, date: reportDateKst, active: active.length, total: stats.length };
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
  formatDailyReportMessage,
  kstDateString,
};

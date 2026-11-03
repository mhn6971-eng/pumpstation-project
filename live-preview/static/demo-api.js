/* Browser-only sample API for the persistent GitHub Pages preview.
 * It intercepts /api/* requests made by the real V5 frontend and answers from
 * an isolated, anonymised snapshot. No network request reaches a station PC.
 */
(function () {
  'use strict';
  const S = JSON.parse(JSON.stringify(window.DEMO_SNAPSHOT || {}));
  const nativeFetch = window.fetch.bind(window);
  const ME = { group: 'admin', role: 'admin', label: 'ادمین نمایشی' };
  const BLOCKED = 'این بخش در نسخه نمایشی مرورگر غیرفعال است؛ در برنامه اصلی روی رایانه ایستگاه فعال است.';
  let nextReportId = Math.max(0, ...(S.reports || []).map(r => r.id || 0)) + 1;
  let nextAlertId = Math.max(0, ...(S.alerts || []).map(a => a.id || 0)) + 1;

  function response(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
  function blocked() { return response({ error: BLOCKED, demo_readonly: true }, 403); }
  function parseBody(opts) {
    if (!opts || !opts.body) return {};
    if (typeof opts.body === 'string') { try { return JSON.parse(opts.body); } catch (_) { return {}; } }
    return {};
  }
  function apiPath(input) {
    const raw = typeof input === 'string' ? input : (input && input.url) || '';
    const u = new URL(raw, location.href);
    const i = u.pathname.indexOf('/api/');
    return { path: i >= 0 ? u.pathname.slice(i) : u.pathname, query: u.searchParams };
  }
  function now() { return S.dashboard.date + ' ' + new Date().toLocaleTimeString('en-GB', { hour12: false }); }
  function shift() { return S.dashboard.shift && S.dashboard.shift.label || 'شیفت A'; }
  function outOf(sp, value) {
    if (!sp || value == null || value === '') return false;
    value = Number(value);
    return (sp.warn_min != null && value < sp.warn_min) || (sp.warn_max != null && value > sp.warn_max) ||
      (sp.crit_min != null && value < sp.crit_min) || (sp.crit_max != null && value > sp.crit_max);
  }
  function physical(sp, value) {
    if (!sp) return;
    value = Number(value);
    if (sp.phys_min != null && value < sp.phys_min) throw new Error('مقدار کمتر از بازه منطقی فیزیکی (' + sp.phys_min + ') است');
    if (sp.phys_max != null && value > sp.phys_max) throw new Error('مقدار بیشتر از بازه منطقی فیزیکی (' + sp.phys_max + ') است');
  }
  function addAlert(source, tag, param, value, sp) {
    if (!outOf(sp, value)) return;
    const severity = (sp.crit_min != null && value < sp.crit_min) || (sp.crit_max != null && value > sp.crit_max) ? 'critical' : 'warning';
    S.alerts.unshift({
      id: nextAlertId++, created_at: now(), date: S.dashboard.date, interval_index: S.dashboard.interval,
      source, tag, param, value: Number(value), severity,
      message: tag + ' / ' + (sp.label || param) + ' = ' + value + ' ' + (sp.unit || ''),
      setpoint_text: 'هشدار ' + (sp.warn_min ?? '—') + ' تا ' + (sp.warn_max ?? '—') + ' / بحرانی ' + (sp.crit_min ?? '—') + ' تا ' + (sp.crit_max ?? '—'),
      active: 1, seen_at: null, acted_at: null
    });
  }
  function refreshDashboard() {
    S.dashboard.alerts = S.alerts.filter(a => a.active);
    S.dashboard.motors.forEach(m => {
      const since = Math.max(0, (m.hmi_hours || 0) - (m.last_service_hours || 0));
      m.hours_since_service = since;
      m.service_pct = Math.min(100, since / (m.service_interval || 2500) * 100);
      m.state_fa = { on: 'روشن', off: 'خاموش/آماده', service: 'در سرویس' }[m.state] || m.state;
    });
    S.dashboard.safety = S.equipment.filter(e => e.safety_critical && !e.deleted_at).map(e => ({
      ...e, status_fa: { ready: 'آماده به کار', running: 'در حال کار', repair: 'در حال تعمیر', service: 'در حال سرویس', in_warehouse: 'در انبار (نصب نشده)' }[e.status] || e.status
    }));
    S.dashboard.time = new Date().toLocaleTimeString('en-GB', { hour12: false });
  }
  function stats(rows) {
    const vals = rows.map(r => Number(r.value)).filter(v => Number.isFinite(v));
    return { count: vals.length, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, min: vals.length ? Math.min(...vals) : null, max: vals.length ? Math.max(...vals) : null };
  }
  function historyRows(scope, param, motor) {
    const rows = scope === 'motor' ? ((S.motor_history[motor] || {})[param] || []) : (S.process_history[param] || []);
    return rows.slice();
  }
  function upsertHistory(rows, row) {
    const i = rows.findIndex(r => r.date === row.date && r.interval_index === row.interval_index);
    if (i >= 0) rows[i] = row; else rows.push(row);
    rows.sort((a, b) => (a.date + a.interval_index).localeCompare(b.date + b.interval_index));
  }
  function reportUrl(kind) { return S.pdf_files[kind] || S.pdf_files.daily || './static/sample-daily.pdf'; }
  function makeReport(kind, body) {
    const id = nextReportId++;
    const filename = kind === 'daily' ? 'گزارش روزانه نمونه.pdf' : kind === 'aux' ? 'گزارش تجهیزات جانبی نمونه.pdf' : 'لیست تجهیزات نمونه.pdf';
    S.reports.unshift({ id, date: S.dashboard.date, shift_label: shift(), kind, filename, created_at: now(), corrected_from: body.corrected_from || null });
    window.DEMO_REPORTS = S.reports;
    return { ok: true, id, filename, url: reportUrl(kind), queued: false };
  }

  async function handle(input, opts) {
    const { path, query } = apiPath(input);
    const method = ((opts && opts.method) || (input && input.method) || 'GET').toUpperCase();
    const body = parseBody(opts);
    if (!path.startsWith('/api/')) return nativeFetch(input, opts);
    try {
      if (path === '/api/me') return response(ME);
      if (path === '/api/login') return response({ ok: true, ...ME, prompt_pin_change: false });
      if (path === '/api/logout') return response({ ok: true });
      if (path === '/api/dashboard') { refreshDashboard(); return response(S.dashboard); }
      if (path === '/api/process' && method === 'POST') {
        const p = S.dashboard.process.find(x => x.tag === body.param);
        if (!p) throw new Error('پارامتر نامعتبر');
        physical(p.setpoint, body.value);
        p.value = Number(body.value); p.edited = 1;
        const interval = body.interval == null ? S.dashboard.interval : Number(body.interval);
        upsertHistory(S.process_history[p.tag] || (S.process_history[p.tag] = []), { date: S.dashboard.date, interval_index: interval, value: p.value, shift_label: shift(), edited: 1 });
        addAlert('process', p.tag, p.tag, p.value, p.setpoint);
        return response({ ok: true });
      }
      if (path === '/api/total' && method === 'POST') {
        S.dashboard.daily_total = { ...(S.dashboard.daily_total || {}), date: S.dashboard.date, value: Number(body.value), edited: 1 };
        return response({ ok: true });
      }
      if (path === '/api/history') {
        const rows = historyRows(query.get('scope') || 'process', query.get('param'), query.get('motor'));
        return response({ rows, stats: stats(rows) });
      }
      if (path === '/api/total/monthly') return response(S.monthly);
      let m = path.match(/^\/api\/motors\/(\d+)$/);
      if (m && method === 'GET') return response(S.motors[m[1]]);
      m = path.match(/^\/api\/motors\/(\d+)\/values$/);
      if (m && method === 'POST') {
        const motor = S.motors[m[1]];
        Object.entries(body.values || {}).forEach(([param, value]) => {
          if (value === '') return;
          const p = motor.params.find(x => x.key === param);
          if (!p) return;
          physical(p.setpoint, value);
          p.value = Number(value);
          const tag = motor.motor.tag;
          upsertHistory((S.motor_history[tag] || (S.motor_history[tag] = {}))[param] || (S.motor_history[tag][param] = []), { date: motor.date, interval_index: motor.interval, value: p.value, shift_label: shift(), edited: 1 });
          addAlert('motor', tag, param, p.value, p.setpoint);
        });
        return response({ ok: true });
      }
      m = path.match(/^\/api\/motors\/(\d+)\/state$/);
      if (m && method === 'POST') {
        const motor = S.motors[m[1]];
        const old = motor.motor.state;
        motor.motor.state = body.state;
        motor.state_history.unshift({ at: now(), old_state: old, new_state: body.state, shift_label: shift() });
        const dm = S.dashboard.motors.find(x => x.id === Number(m[1]));
        if (dm) dm.state = body.state;
        refreshDashboard();
        return response({ ok: true });
      }
      m = path.match(/^\/api\/motors\/(\d+)\/(service|megger|oil|hmi)$/);
      if (m) return blocked();
      m = path.match(/^\/api\/alerts\/(\d+)\/ack$/);
      if (m && method === 'POST') {
        const a = S.alerts.find(x => x.id === Number(m[1]));
        if (a) { a.active = 0; if (body.kind === 'seen') a.seen_at = now(); else a.acted_at = now(); }
        refreshDashboard();
        return response({ ok: true });
      }
      if (path === '/api/alerts') return response(S.alerts);
      if (path === '/api/operator-report') {
        if (method === 'POST') { S.operator_report = { text: body.text || '' }; return response({ ok: true }); }
        return response(S.operator_report || { text: '' });
      }
      if (path === '/api/schedule') {
        if (method === 'POST') {
          const member = S.roster.find(r => String(r.id) === String(body.member_id));
          const rep = S.roster.find(r => String(r.id) === String(body.replacement_member_id));
          S.schedule.unshift({ time: body.time || '', type: body.type, type_label: body.type === 'leave' ? 'مرخصی' : 'جابجایی', member: member ? member.name : '—', replacement: rep ? rep.name : '—', note: body.note || '' });
          return response({ ok: true });
        }
        return response(S.schedule);
      }
      if (path === '/api/roster') return response(S.roster);
      if (path === '/api/aux') return response(S.aux);
      m = path.match(/^\/api\/aux\/(\d+)\/state$/);
      if (m && method === 'POST') {
        const row = S.aux.find(x => x.id === Number(m[1]));
        if (row) { row.run_state = body.run_state; row.status = body.status; row.status_changed_shift = shift(); }
        return response({ ok: true });
      }
      if (path === '/api/categories') return response(S.categories);
      if (path === '/api/equipment') {
        if (method === 'GET') {
          const cat = query.get('category'); const q = (query.get('q') || '').toLowerCase();
          return response(S.equipment.filter(e => (query.get('include_deleted') || !e.deleted_at) && (!cat || String(e.category_id) === cat) && (!q || (e.tag + ' ' + e.name).toLowerCase().includes(q))));
        }
        return blocked();
      }
      if (path.startsWith('/api/equipment/')) return blocked();
      if (path === '/api/maintenance') {
        if (method === 'GET') { const eid = query.get('equipment_id'); return response(S.maintenance.filter(x => !eid || String(x.equipment_id) === eid)); }
        if (method === 'POST') { S.maintenance.unshift({ equipment_id: Number(body.equipment_id), date: body.date || S.dashboard.date, shift_label: shift(), workers: body.workers || '', note: body.note || '' }); return response({ ok: true }); }
      }
      if (path.startsWith('/api/maintenance/')) return blocked();
      if (path === '/api/pm-templates') return response(S.pm_templates);
      if (path.startsWith('/api/pm-templates/')) return blocked();
      if (path === '/api/training') {
        if (method === 'GET') return response(S.training);
        return blocked();
      }
      if (path.startsWith('/api/training/')) return blocked();
      if (path === '/api/problems') {
        if (method === 'GET') return response(S.problems);
        if (method === 'POST') { S.problems.unshift({ at: now(), shift_label: shift(), text: body.text || '' }); return response({ ok: true }); }
      }
      if (path === '/api/reports') return response(S.reports);
      if (path === '/api/reports/daily' && method === 'POST') return response(makeReport(body.correction ? 'daily-correction' : 'daily', body));
      if (path === '/api/reports/aux' && method === 'POST') return response(makeReport('aux', body));
      if (path === '/api/reports/registry' && method === 'POST') return response(makeReport('registry', body));
      if (path.startsWith('/api/reports/')) return response({ error: 'فایل PDF نمونه از دکمه ساخت PDF قابل مشاهده است.' }, 404);
      if (path === '/api/search') {
        const q = (query.get('q') || '').toLowerCase();
        return response({
          equipment: S.equipment.filter(e => !e.deleted_at && (e.tag + ' ' + e.name).toLowerCase().includes(q)).slice(0, 30),
          reports: S.reports.filter(r => (r.date + ' ' + r.filename).toLowerCase().includes(q)).slice(0, 30),
          alerts: S.alerts.filter(a => (a.tag + ' ' + a.message + ' ' + a.date).toLowerCase().includes(q)).slice(0, 30)
        });
      }
      if (path === '/api/admin/status') { refreshDashboard(); return response(S.admin.status); }
      if (path === '/api/admin/setpoints' && method === 'GET') return response(S.admin.setpoints);
      if (path === '/api/admin/groups' && method === 'GET') return response(S.admin.groups);
      if (path === '/api/admin/channels' && method === 'GET') return response(S.admin.channels);
      if (path === '/api/admin/queue' && method === 'GET') return response(S.admin.queue);
      if (path === '/api/admin/backups' && method === 'GET') return response(S.admin.backups);
      if (path === '/api/admin/activity' && method === 'GET') return response(S.admin.activity);
      if (path === '/api/admin/errors' && method === 'GET') return response([]);
      if (path === '/api/admin/archives' && method === 'GET') return response(S.admin.archives);
      if (path === '/api/admin/changelog' && method === 'GET') return response(S.admin.changelog);
      if (path === '/api/admin/logo' && method === 'GET') return response({ exists: false });
      if (path.startsWith('/api/admin/')) return blocked();
      return response({ error: 'این مسیر در نسخه نمایشی مرورگر وجود ندارد.' }, 404);
    } catch (e) {
      return response({ error: e.message || 'خطا در نسخه نمایشی' }, 400);
    }
  }

  window.fetch = function (input, opts) {
    const raw = typeof input === 'string' ? input : (input && input.url) || '';
    if (raw.includes('/api/')) return handle(input, opts);
    return nativeFetch(input, opts);
  };
})();

module.exports = async (page) => {
  const baseUrl = 'https://20260704155001.vercel.app';
  
  // 获取规则
  const rulesRes = await page.evaluate(async () => {
    const r = await fetch('/api/rules');
    return await r.json();
  });
  const rowRules = rulesRes.filter(r => r.config?.engine === 'row' || r.name?.includes('默认'));
  console.log('RULES:', JSON.stringify(rowRules.slice(0, 3).map(r => ({ id: r.id, name: r.name }))));
  
  const rule = rowRules[0] || rulesRes[0];
  if (!rule) return 'NO RULES';
  
  // 构造 CSV Blob 并上传
  const result = await page.evaluate(async (ruleId) => {
    const csv = 'orderNo,recipientName,recipientPhone,skuCode,skuName,qty\nORD001,张三,13800138000,SKU001,商品A,10';
    const blob = new Blob([csv], { type: 'text/csv' });
    const fd = new FormData();
    fd.append('file', blob, 'test.csv');
    fd.append('fileType', 'csv');
    fd.append('ruleId', ruleId);
    
    const t0 = Date.now();
    const res = await fetch('/api/import-tasks', { method: 'POST', body: fd });
    const elapsed = Date.now() - t0;
    const body = await res.text();
    return { status: res.status, elapsed, body: body.slice(0, 3000) };
  }, rule.id);
  
  return JSON.stringify(result);
};

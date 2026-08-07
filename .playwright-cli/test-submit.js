module.exports = async (page) => {
  // Step 1: 获取规则，选一条 row 引擎的
  const rules = await page.evaluate(async () => {
    const r = await fetch('/api/rules');
    return await r.json();
  });
  
  const rule = rules.find(r => r.name?.includes('默认') || r.config?.engine === 'row' || r.name?.includes('标准行表格'));
  if (!rule) return 'NO_ROW_RULE';
  
  // Step 2: 在浏览器中用 fetch + Blob 提交
  const result = await page.evaluate(async (ruleId) => {
    // 构造一个小 CSV
    const csv = 'orderNo,recipientName,recipientPhone,skuCode,skuName,qty\nORD001,张三,13800138000,SKU001,商品A,10\nORD002,李四,13800138001,SKU002,商品B,20';
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
  
  return JSON.stringify({ ruleId: rule.id, ruleName: rule.name, ...result });
};

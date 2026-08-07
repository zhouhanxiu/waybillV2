module.exports = async (page) => {
  // 拦截所有 fetch 请求，记录 import-tasks 的响应
  const importResults = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('/api/import-tasks') && resp.request().method() === 'POST') {
      try {
        const body = await resp.text();
        importResults.push({ status: resp.status(), body: body.slice(0, 2000) });
      } catch {}
    }
  });
  
  // 等待页面加载完成
  await page.waitForSelector('input[type=file]', { timeout: 10000 });
  
  // 上传文件
  const fileInput = await page.$('input[type=file]');
  await fileInput.setInputFiles('test-data/10000-orders.xlsx');
  await page.waitForTimeout(3000);
  
  // 等待 AI 推断完成，获取选择框
  await page.waitForTimeout(2000);
  
  // 查看有哪些选择
  const selects = await page.$$eval('select', opts => 
    opts.map(o => ({ 
      options: Array.from(o.options).map(opt => ({ text: opt.text.trim(), value: opt.value }))
    }))
  );
  
  // 选择规则下拉框 - 选本地默认规则
  const ruleSelect = await page.$('select');
  if (ruleSelect) {
    const options = await ruleSelect.$$eval('option', opts =>
      opts.map(o => ({ text: o.text.trim(), value: o.value }))
    );
    const defaultRule = options.find(o => o.text.includes('本地默认规则') || o.text.includes('row'));
    if (defaultRule) {
      await ruleSelect.selectOption(defaultRule.value);
      await page.waitForTimeout(500);
    }
  }
  
  // 找到提交按钮并点击
  const buttons = await page.$$eval('button', btns => 
    btns.map(b => ({ text: b.textContent.trim().slice(0, 50), disabled: b.disabled }))
  );
  
  const submitBtn = await page.$('button.bg-jingtian, button:has-text("提交"), button:has-text("开始导入"), button:has-text("导入")');
  if (!submitBtn) {
    return JSON.stringify({ error: 'NO_SUBMIT_BTN', buttons });
  }
  
  await submitBtn.click();
  
  // 等待响应
  await page.waitForTimeout(8000);
  
  return JSON.stringify({ 
    importResults,
    selects,
    buttons,
    url: page.url()
  });
};

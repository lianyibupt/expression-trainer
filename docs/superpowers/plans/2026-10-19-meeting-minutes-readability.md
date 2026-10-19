# 会议纪要可读性实施计划

**Goal:** 提升纪要内容归纳规则，并把 Markdown 展示为可扫读的结构。

**Architecture:** `lib/prompts.js` 管理正式与分段提取规则，`lib/ai-feedback.js` 管理纪要请求参数与完整性；`src/markdown.js` 独立渲染受支持的 Markdown 子集，`src/app.js` 调用，样式限制在纪要区。

**Tech Stack:** 现有 Electron、原生 JavaScript、CSS、Node test runner，不引入运行时依赖。

- [x] 在 `test/meeting-markdown.test.js` 通过页面实际脚本加载渲染方法，覆盖列表、表格、HTML 转义和代码块；运行测试确认现有渲染失败。
- [x] 扩充 `test/meeting-minutes.test.js`，通过 mock fetch 验证短文直出、长文有序提取、低温度与不完整响应拒绝；运行测试确认失败。
- [x] 增强正式和分段提示词，按议题组织，区分描述/观点/建议/计划与本次决定，保留归属、条件和分歧。纪要请求温度设为 0.2，检查空白及截断输出。
- [x] 在 `src/markdown.js` 实现安全的 Markdown 子集渲染；`src/index.html` 在 app 前加载模块；纪要正文增加独立样式类，支持表格滚动和清晰的层级与间距。
- [x] `src/app.js` 委托渲染；重新生成失败恢复旧纪要，错误写入独立状态提示。
- [x] 执行 `node --test test/*.test.js`、JavaScript 语法检查与 `git diff --check`；以 mock API 在真实页面验证生成、复制、保存、失败恢复以及桌面/窄屏布局。

实现与自审均在当前会话完成；不提交、推送或修改历史会议数据。

## 验证结果

- 全量 Node 测试：95/95 通过。修改的 JavaScript 语法检查及 `git diff --check` 通过。
- 在用户现有 Chrome 的临时本地预览中验证实际页面：标题、嵌套列表、两张表格、复制和保存调用、重新生成失败后恢复上版纪要。
- 两档窄视口检查：页面和正文均无横向溢出，表格在局部容器内横向滚动；恢复了浏览器原有视口。
- 浏览器使用合成纪要与 mock API，没有调用真实模型，也没有改动历史会议、真实配置或正在运行的桌面会话。真实会议的模型生成质量尚待重新生成后评价。

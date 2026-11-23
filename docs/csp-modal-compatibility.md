# 严格 CSP 下的弹窗与手机抽屉

聊天服务的响应头保持 `style-src 'self'`。线上验收发现，Radix 弹窗 Overlay 所使用的滚动条锁会动态插入 style 标签，在该策略下被拒绝。资源监控服务允许的样式策略较宽，因此同一问题可能只在聊天入口打开弹窗时出现。

前端适配保留 Radix Content 的焦点圈定、ARIA 隐藏、Esc 与外部点击关闭，以及 react-remove-scroll 的滚轮 / 触摸隔离；只替换 Overlay 的样式注入路径。滚动条处理改用 CSSOM 更新 body 属性，并在最后一层弹窗退出后还原原值与优先级。锁计数支持多层弹窗，不通过放宽后端 CSP 解决。

- 共用适配：`packages/harness-ui/src/lib/csp-modal.tsx`。
- 应用位置：Harness `Dialog` 和 `Sheet`；Root 支持受控与非受控状态，内容 ref 继续转发。
- 依赖：显式声明已有的 `react-remove-scroll@2.7.2`，没有升级它的版本；第三方许可仍见 THIRD_PARTY_NOTICES.md。
- 使用路径仍为本项目的 Basilos / Harness 组件，不修改旁边的原组件维护仓库。

浏览器回归新增严格 CSP 专项：桌面与手机下打开弹窗、Tab 焦点圈定、body 滚动锁、Esc / 外部点击关闭、焦点和 body 属性恢复，以及模型菜单。既有主题、项目空间、审批、文件和输入框流程继续通过完整浏览器检查。专项只证明本项目使用路径，不代表已验证组件库所有可选分支。

此次修复只影响前端组件与配套依赖，后端响应头、模型服务、Cookie、来源授权与项目审批没有变化。静态发布继续使用新的独立资源目录和已有的两个发布链接。

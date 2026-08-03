/**
 * Top-level route map.
 *
 *   /login           → 登录页（公开）
 *   /                → 评测中心（受保护:RequireAuth + QAStoreProvider）
 *   /library         → 题库全屏（统计 / 筛选 / 表 / 抽屉详情）
 *   /library/:id     → 单题详情（测试历史）
 *   /reports/:id     → 评测报告快照（HTML 预览 + MD 导出）
 *
 * Other left-nav items (Employees) open as modals on top of the current page
 * (see ChatSidebar nav).
 */

import { createBrowserRouter } from "react-router-dom";

import App from "./App";
import { LibraryPage } from "./pages/LibraryPage";
import { QuestionDetailPage } from "./pages/QuestionDetailPage";
import { ReportPreviewPage } from "./pages/ReportPreviewPage";
import { SkillReportPreviewPage } from "./pages/SkillReportPreviewPage";
import { ReportsListPage } from "./pages/ReportsListPage";
import { SkillsPage } from "./pages/SkillsPage";
import { SkillOptPage } from "./pages/SkillOptPage";
import { SkillsRepoPage } from "./pages/SkillsRepoPage";
import { SkillsComparePage } from "./pages/SkillsComparePage";
import { PromptsPage } from "./pages/PromptsPage";
import { EvaluationRunsPage } from "./pages/EvaluationRunsPage";
import { QAStoreProvider } from "@/hooks/use-qa-store";
import { RequireAuth } from "@/components/auth/require-auth";
import { LoginPage } from "./pages/LoginPage";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    path: "/",
    element: (
      <RequireAuth>
        <QAStoreProvider>
          <App />
        </QAStoreProvider>
      </RequireAuth>
    ),
    // 首页(WorkspaceLayout)不在这里挂为 index 路由 —— 改由 App 常驻挂载、按路由显隐,
    // 这样从首页跳到题库等页面再返回时,首页保留原状、不被卸载重建(不刷新)。
    children: [
      { path: "library", element: <LibraryPage /> },
      { path: "library/:id", element: <QuestionDetailPage /> },
      { path: "reports", element: <ReportsListPage /> },
      { path: "runs", element: <EvaluationRunsPage /> },
      { path: "reports/:id", element: <ReportPreviewPage /> },
      { path: "skill-reports/:id", element: <SkillReportPreviewPage /> },
      { path: "skills", element: <SkillsPage /> },
      { path: "skillopt", element: <SkillOptPage /> },
      { path: "skills-repo", element: <SkillsRepoPage /> },
      { path: "skills-compare", element: <SkillsComparePage /> },
      { path: "prompts", element: <PromptsPage /> },
    ],
  },
]);

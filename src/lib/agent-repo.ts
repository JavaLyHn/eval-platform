export interface AgentRepoEmployee {
  dir: string;
  name: string;
  skillCount: number;
  defFiles: string[];
}

export interface AgentRepoSkillSummary {
  name: string;
  description: string;
  version: string | null;
}

export interface AgentRepoSkill extends AgentRepoSkillSummary {
  body: string;
  references: string[];
  hasScripts: boolean;
  hasTemplates: boolean;
  files: string[];
}

export interface AgentRepoCommon {
  prompts: { path: string }[];
  okrExecutor: AgentRepoSkill;
}

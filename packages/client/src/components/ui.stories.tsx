import type { StateData } from "@imane/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useEffect } from "react";
import { useApp } from "../context";
import { ConditionChips, Empty, StateChip, StateChips, Tabs } from "./ui";

const SAMPLE_STATES: StateData[] = [
  { id: "S001", name: "Web サーバ停止", description: "公開 Web サーバが応答しない", icon: "fa-server" },
  {
    id: "S002",
    name: "マルウェア検知",
    description: "EDR がアラートを上げた",
    icon: "fa-bug",
    effect: "html:<p>検知!</p>",
  },
  { id: "P001", name: "初動フェーズ開始", type: 1 },
];

/** ステートカード定義をコンテキストに読み込んでから描画する */
function WithStates({ children }: { children: ReactNode }) {
  const { states, setStates } = useApp();
  useEffect(() => setStates(SAMPLE_STATES), [setStates]);
  return states.length > 0 ? children : null;
}

const meta = {
  title: "Components/StateChip",
  component: StateChip,
  decorators: [
    (Story) => (
      <WithStates>
        <Story />
      </WithStates>
    ),
  ],
  args: { id: "S001" },
} satisfies Meta<typeof StateChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Add: Story = { args: { kind: "add" } };
export const Remove: Story = { args: { kind: "remove" } };
export const PhaseStart: Story = { args: { id: "P001" } };
export const WithEffect: Story = { args: { id: "S002", onPlay: () => {} } };
export const Undefined: Story = { args: { id: "X999" } };

export const Chips: Story = {
  render: () => <StateChips ids={["S001", "S002", "P001"]} kind="add" />,
};

export const Condition: Story = {
  render: () => <ConditionChips cond={["S001", "S002", "AND", "P001", "NOT", "OR"]} />,
};

export const TabsExample: Story = {
  name: "Tabs",
  render: () => (
    <Tabs
      tabs={[
        { id: "a", label: "イベント", content: () => <p>イベント一覧</p> },
        { id: "b", label: "ステート", content: () => <Empty /> },
      ]}
    />
  ),
};

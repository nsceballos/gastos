"use client";
import { useState } from "react";
import { PageHeader, Segmented } from "@/components/ui";
import { Chat } from "@/components/ai/Chat";
import { BudgetSuggestion } from "@/components/ai/BudgetSuggestion";

type Tab = "chat" | "presupuesto";

export default function AsesorPage() {
  const [tab, setTab] = useState<Tab>("chat");
  return (
    <>
      <PageHeader title="Asesor IA">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "chat", label: "Chat" },
            { value: "presupuesto", label: "Presupuesto IA" },
          ]}
          className="mt-3"
        />
      </PageHeader>
      {tab === "chat" ? <Chat /> : <BudgetSuggestion />}
    </>
  );
}

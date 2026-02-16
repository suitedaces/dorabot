import { useState } from 'react';
import type { useGateway } from '../hooks/useGateway';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SkillsView } from './Skills';
import { McpView } from './Mcp';
import { Sparkles, Plug } from 'lucide-react';

type Props = {
  gateway: ReturnType<typeof useGateway>;
};

export function ExtensionsView({ gateway }: Props) {
  const [activeTab, setActiveTab] = useState<'skills' | 'mcp'>('skills');

  return (
    <div className="flex flex-col h-full min-h-0">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'skills' | 'mcp')} className="flex flex-col h-full min-h-0">
        <TabsList className="shrink-0 grid grid-cols-2 w-full h-10 rounded-none border-b border-border bg-card">
          <TabsTrigger value="skills" className="data-[state=active]:bg-secondary rounded-none gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            Skills
          </TabsTrigger>
          <TabsTrigger value="mcp" className="data-[state=active]:bg-secondary rounded-none gap-1.5">
            <Plug className="w-3.5 h-3.5" />
            MCP Servers
          </TabsTrigger>
        </TabsList>

        <TabsContent value="skills" className="flex-1 min-h-0 m-0">
          <SkillsView gateway={gateway} />
        </TabsContent>

        <TabsContent value="mcp" className="flex-1 min-h-0 m-0">
          <McpView gateway={gateway} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

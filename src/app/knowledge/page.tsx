'use client';

import { useState, useEffect, useCallback } from 'react';
import { Brain } from 'lucide-react';
import { PageHeader } from '@/components/shared/ui-parts';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ObjectList } from './components/object-list';
import { ObjectDetail } from './components/object-detail';
import { GraphView } from './components/graph-view';
import { ReviewQueue } from './components/review-queue';
import { ConsolidationLog } from './components/consolidation-log';

export default function KnowledgePage() {
  const [objects, setObjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [stats, setStats] = useState<any>(null);

  const fetchObjects = useCallback(async () => {
    try {
      // Fetch all statuses for the list view
      const [activeRes, dormantRes, statsRes] = await Promise.all([
        fetch('/api/todoist?action=knowledge&status=active'),
        fetch('/api/todoist?action=knowledge&status=dormant'),
        fetch('/api/todoist?action=knowledge-stats'),
      ]);
      const active = activeRes.ok ? await activeRes.json() : [];
      const dormant = dormantRes.ok ? await dormantRes.json() : [];
      setObjects([...active, ...dormant]);
      if (statsRes.ok) setStats(await statsRes.json());
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchObjects(); }, [fetchObjects]);

  const handleSelectObject = (id: string) => setSelectedObjectId(id);
  const handleBack = () => setSelectedObjectId(null);

  // If viewing object detail, show that instead of tabs
  if (selectedObjectId) {
    return (
      <div>
        <PageHeader title="Knowledge Graph" description="Ontology-driven personal knowledge" />
        <ObjectDetail
          objectId={selectedObjectId}
          onBack={handleBack}
          onRefresh={fetchObjects}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Knowledge Graph"
        description={stats ? `${stats.totalObjects ?? 0} objects · ${stats.withEmbedding ?? 0} embedded` : 'Ontology-driven personal knowledge'}
      />

      <Tabs defaultValue="list" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="list">List</TabsTrigger>
          <TabsTrigger value="graph">Graph</TabsTrigger>
          <TabsTrigger value="review">Review</TabsTrigger>
          <TabsTrigger value="log">Log</TabsTrigger>
        </TabsList>

        <TabsContent value="list">
          <ObjectList
            objects={objects}
            loading={loading}
            onSelectObject={handleSelectObject}
          />
        </TabsContent>

        <TabsContent value="graph">
          <GraphView onSelectObject={handleSelectObject} />
        </TabsContent>

        <TabsContent value="review">
          <ReviewQueue />
        </TabsContent>

        <TabsContent value="log">
          <ConsolidationLog />
        </TabsContent>
      </Tabs>
    </div>
  );
}

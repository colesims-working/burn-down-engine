'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

// Dynamic import to avoid SSR issues with canvas
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

const TYPE_COLORS: Record<string, string> = {
  person: '#3b82f6',      // blue
  concept: '#22c55e',     // green
  project: '#f97316',     // orange
  event: '#a855f7',       // purple
  organization: '#6b7280', // gray
};

interface GraphViewProps {
  onSelectObject: (id: string) => void;
}

export function GraphView({ onSelectObject }: GraphViewProps) {
  const [objects, setObjects] = useState<any[]>([]);
  const [links, setLinks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAbsorbed, setShowAbsorbed] = useState(false);
  const [hoveredLink, setHoveredLink] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      try {
        const [objRes, linkRes] = await Promise.all([
          fetch('/api/todoist?action=knowledge&status=active'),
          fetch('/api/todoist?action=knowledge-links'),
        ]);
        let objs = objRes.ok ? await objRes.json() : [];
        const lnks = linkRes.ok ? await linkRes.json() : [];

        if (showAbsorbed) {
          const absorbedRes = await fetch('/api/todoist?action=knowledge&status=absorbed');
          if (absorbedRes.ok) objs = [...objs, ...(await absorbedRes.json())];
          const dormantRes = await fetch('/api/todoist?action=knowledge&status=dormant');
          if (dormantRes.ok) objs = [...objs, ...(await dormantRes.json())];
        }

        setObjects(objs);
        setLinks(lnks);
      } catch {} finally { setLoading(false); }
    }
    load();
  }, [showAbsorbed]);

  const graphData = useMemo(() => {
    const nodeIds = new Set(objects.map((o: any) => o.id));

    const nodes = objects.map((o: any) => ({
      id: o.id,
      name: o.name,
      type: o.type,
      status: o.status,
      confidence: o.confidence ?? 0.7,
      color: TYPE_COLORS[o.type] || TYPE_COLORS.concept,
      val: Math.max(2, (o.confidence ?? 0.7) * 8),
    }));

    const edges = links
      .filter((l: any) => nodeIds.has(l.sourceId) && nodeIds.has(l.targetId))
      .map((l: any) => ({
        source: l.sourceId,
        target: l.targetId,
        linkType: l.linkType,
        id: l.id,
      }));

    return { nodes, links: edges };
  }, [objects, links]);

  const handleNodeClick = useCallback((node: any) => {
    onSelectObject(node.id);
  }, [onSelectObject]);

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading graph...</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{graphData.nodes.length} nodes</span>
          <span>{graphData.links.length} edges</span>
        </div>
        <button
          onClick={() => setShowAbsorbed(!showAbsorbed)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent"
        >
          {showAbsorbed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          {showAbsorbed ? 'Hide' : 'Show'} absorbed/dormant
        </button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-[10px]">
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1">
            <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-muted-foreground">{type}</span>
          </div>
        ))}
      </div>

      {/* Graph Canvas */}
      <div ref={containerRef} className="rounded-lg border border-border bg-card overflow-hidden" style={{ height: '500px' }}>
        {typeof window !== 'undefined' && (
          <ForceGraph2D
            graphData={graphData}
            nodeLabel={(node: any) => `${node.name} (${node.type})`}
            nodeColor={(node: any) => node.color}
            nodeRelSize={4}
            nodeVal={(node: any) => node.val}
            nodeCanvasObjectMode={() => 'after' as const}
            nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
              if (globalScale < 1.5) return;
              const label = node.name;
              const fontSize = 10 / globalScale;
              ctx.font = `${fontSize}px sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillStyle = node.status === 'dormant' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.8)';
              ctx.fillText(label, node.x, node.y + node.val + fontSize);
            }}
            linkColor={() => 'rgba(255,255,255,0.1)'}
            linkWidth={1}
            linkLabel={(link: any) => link.linkType}
            onNodeClick={handleNodeClick}
            backgroundColor="transparent"
            width={containerRef.current?.clientWidth || 800}
            height={500}
          />
        )}
      </div>
    </div>
  );
}

// Drawn only in the song-splits view (staff dashboard + client portal) and loaded on demand from
// SplitsPie in App.jsx — recharts outweighs everything the public pages need put together.
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { splitPct } from "../lib/pct";

// each slice's colour comes with it (components/dash/ui.jsx splitColors), so the list beside the pie matches. (2026-11-26 review) No legend: that list names each colour, with its %,
// right under the donut. The donut fills the box it's given (it had a 30px legend band under it), so the song window's 200 is the size its 230 used to draw
export default function SplitsPieChart({ data, size }) {
  return (
    <ResponsiveContainer width="100%" height={size}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
          outerRadius={size * 0.44} innerRadius={size * 0.255} paddingAngle={data.length > 1 ? 2 : 0} stroke="#0b0b0c" strokeWidth={2}>
          {data.map((d, i) => <Cell key={i} fill={d.color} />)}
        </Pie>
        <Tooltip formatter={(v, n) => [`${splitPct(v)}%`, n]} contentStyle={{ background: "#111113", border: "1px solid #2a2a2c", borderRadius: 10, color: "#f5f5f5" }} itemStyle={{ color: "#f5f5f5" }} labelStyle={{ color: "#f5f5f5" }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

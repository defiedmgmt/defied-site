// Drawn only in the song-splits view (staff dashboard + client portal) and loaded on demand from
// SplitsPie in App.jsx — recharts outweighs everything the public pages need put together.
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";

export default function SplitsPieChart({ data, size, colors }) {
  return (
    <ResponsiveContainer width="100%" height={size}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
          outerRadius={size * 0.38} innerRadius={size * 0.22} paddingAngle={data.length > 1 ? 2 : 0} stroke="#0b0b0c" strokeWidth={2}>
          {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
        </Pie>
        <Tooltip formatter={(v, n) => [`${v}%`, n]} contentStyle={{ background: "#111113", border: "1px solid #2a2a2c", borderRadius: 10, color: "#f5f5f5" }} itemStyle={{ color: "#f5f5f5" }} labelStyle={{ color: "#f5f5f5" }} />
        <Legend verticalAlign="bottom" height={30} formatter={(value) => <span style={{ color: "#a3a3a3", fontSize: 12 }}>{value}</span>} />
      </PieChart>
    </ResponsiveContainer>
  );
}

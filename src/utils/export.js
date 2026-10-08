import {
  getCheckinItems,
  getCheckinRecords,
  getTodos,
  getMonthlyData,
  getYearlyData,
  TODO_PRIORITIES,
} from './storage';

/**
 * 导出工具 — CSV / JSON 格式导出
 */

function downloadCSV(data, headers, filename) {
  const headerLine = headers.join(',');
  const rows = data.map((row) =>
    headers.map((h) => {
      const val = row[h] != null ? String(row[h]) : '';
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    }).join(',')
  );
  const csvContent = [headerLine, ...rows].join('\n');
  const bom = '\uFEFF';
  downloadFile(bom + csvContent, `${filename}.csv`, 'text/csv;charset=utf-8');
}

function downloadJSON(data, filename) {
  const jsonContent = JSON.stringify(data, null, 2);
  downloadFile(jsonContent, `${filename}.json`, 'application/json;charset=utf-8');
}

export function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 导出打卡记录为 CSV
 */
export function exportCheckinCSV(year, month) {
  const items = getCheckinItems();
  const monthlyData = getMonthlyData(year, month);

  const headers = ['日期', ...items.map((i) => i.name), '完成数', '总数', '完成率'];
  const rows = monthlyData.map((day) => {
    const records = getCheckinRecords();
    const dayRecord = records[day.date] || {};
    const row = { 日期: day.date };
    items.forEach((item) => {
      const r = dayRecord[item.id];
      const completed = r && (r === true || (typeof r === 'object' && r.completed));
      row[item.name] = completed ? '✓' : '✗';
    });
    row['完成数'] = day.completed;
    row['总数'] = day.total;
    row['完成率'] = `${day.rate}%`;
    return row;
  });

  downloadCSV(rows, headers, `打卡记录_${year}-${String(month).padStart(2, '0')}`);
}

/**
 * 导出打卡记录为 JSON
 */
export function exportCheckinJSON(year, month) {
  const items = getCheckinItems();
  const monthlyData = getMonthlyData(year, month);
  const records = getCheckinRecords();

  const data = {
    exportDate: new Date().toISOString(),
    period: `${year}-${String(month).padStart(2, '0')}`,
    items: items.map((i) => ({ id: i.id, name: i.name })),
    dailyRecords: monthlyData.map((day) => ({
      date: day.date,
      completed: day.completed,
      total: day.total,
      rate: day.rate,
      details: records[day.date] || {},
    })),
  };

  downloadJSON(data, `打卡记录_${year}-${String(month).padStart(2, '0')}`);
}

/**
 * 导出年度汇总 CSV
 */
export function exportYearlyCSV(year) {
  const yearlyData = getYearlyData(year);

  const headers = ['月份', '完成数', '总数', '完成率'];
  const rows = yearlyData.monthData.map((m) => ({
    月份: m.month,
    完成数: m.completed,
    总数: m.total,
    完成率: `${m.rate}%`,
  }));

  downloadCSV(rows, headers, `年度汇总_${year}`);
}

/**
 * 导出年度汇总 JSON
 */
export function exportYearlyJSON(year) {
  const yearlyData = getYearlyData(year);

  const data = {
    exportDate: new Date().toISOString(),
    year,
    avgRate: yearlyData.avgRate,
    monthlyData: yearlyData.monthData,
  };

  downloadJSON(data, `年度汇总_${year}`);
}

/**
 * 导出待办事项为 CSV（适配新数据模型）
 */
export function exportTodosCSV() {
  const todos = getTodos();
  const headers = [
    '标题',
    'SITUATION-背景',
    'TARGET-目标',
    'ACTION-行动',
    'RESULT-结果',
    '创建时间',
    '截止日期',
    '优先级',
    '状态',
    '完成时间',
    'KEEP-保持',
    'IMPROVE-改进',
    'STOP-停止',
    'START-开始',
  ];
  const rows = todos.map((t) => {
    const d = t.description || {};
    const r = t.review || {};
    const priorityLabel = (TODO_PRIORITIES[t.priority] && TODO_PRIORITIES[t.priority].label) || t.priority;
    // 优先用 phases 列表导出 ACTION 列（含勾选标记），没有则回退到 description.action 旧字段
    let actionCell = '';
    if (Array.isArray(t.phases) && t.phases.length > 0) {
      actionCell = t.phases
        .map((p) => `[${p.completed ? '✓' : '○'}]${p.name}${p.completedTime ? ` (${p.completedTime})` : ''}`)
        .join(' | ');
    } else if (d.action) {
      actionCell = d.action.replace(/\r?\n/g, ' | ');
    }
    return {
      标题: t.title,
      'SITUATION-背景': d.situation || '',
      'TARGET-目标': d.target || '',
      'ACTION-行动': actionCell,
      'RESULT-结果': d.result || '',
      创建时间: t.createdAt,
      截止日期: t.dueDate || '',
      优先级: priorityLabel,
      状态: t.completed ? '已完成' : '待完成',
      完成时间: t.completedTime || '',
      'KEEP-保持': r.keep || '',
      'IMPROVE-改进': r.improve || '',
      'STOP-停止': r.stop || '',
      'START-开始': r.start || '',
    };
  });

  downloadCSV(rows, headers, '待办事项');
}

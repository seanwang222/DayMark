import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Box,
  Typography,
  Button,
  Divider,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import TodoCard from '../components/TodoCard';
import AddTodoDialog from '../components/AddTodoDialog';
import TodoCompleteDialog from '../components/TodoCompleteDialog';
import ConfirmDialog from '../components/ConfirmDialog';
import {
  getTodos,
  addTodo,
  editTodo,
  toggleTodo,
  deleteTodo,
  reorderTodos,
  toggleTodoPhase,
  TODO_PRIORITIES,
} from '../utils/storage';

/**
 * 待办事项页面（左右布局）
 * 左侧：待办事项列表 | 右侧：柯维四象限汇总
 * 左右两侧联动高亮
 */
function TodoPage() {
  const [todos, setTodos] = useState(() => getTodos());
  const [filter, setFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTodoItem, setEditTodoItem] = useState(null);
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [completingTodo, setCompletingTodo] = useState(null);
  const [recordEditOpen, setRecordEditOpen] = useState(false);
  const [recordEditTodo, setRecordEditTodo] = useState(null);
  const [selectedPriority, setSelectedPriority] = useState(null);
  const [selectedTodoId, setSelectedTodoId] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const leftListRef = useRef(null);

  const refreshTodos = useCallback(() => {
    setTodos([...getTodos()]);
  }, []);

  useEffect(() => {
    refreshTodos();
  }, [refreshTodos]);

  // 滚动到选中的待办
  useEffect(() => {
    if (selectedTodoId && leftListRef.current) {
      const el = leftListRef.current.querySelector(`[data-todo-id="${selectedTodoId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, [selectedTodoId]);

  // 统一排序：先按优先级（Q1→Q2→Q3→Q4），同优先级内按 order
  // 这一份顺序同时驱动「左侧列表」与「右侧四象限」，确保两侧排序打通
  const PRIORITY_RANK = {
    urgent_important: 0,        // Q1 重要且紧急
    urgent_not_important: 1,    // Q2 紧急不重要
    not_urgent_important: 2,    // Q3 重要不紧急
    not_urgent_not_important: 3, // Q4 不重要不紧急
  };
  const displayTodos = useMemo(
    () =>
      [...todos].sort(
        (a, b) =>
          (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
          a.order - b.order,
      ),
    [todos],
  );

  // 左侧列表的分组顺序与中文标签（与四象限、统一排序一一对应）
  const GROUP_ORDER = [
    'urgent_important',
    'urgent_not_important',
    'not_urgent_important',
    'not_urgent_not_important',
  ];
  const GROUP_LABELS = {
    urgent_important: '重要且紧急',
    urgent_not_important: '紧急不重要',
    not_urgent_important: '重要不紧急',
    not_urgent_not_important: '不紧急不重要',
  };

  // 筛选（基于统一排序后的列表）
  const filteredDisplay = useMemo(
    () =>
      displayTodos.filter((t) => {
        if (filter === 'all') return true;
        if (filter === 'pending') return !t.completed;
        if (filter === 'completed') return t.completed;
        return true;
      }),
    [displayTodos, filter],
  );

  // 统计
  const totalCount = todos.length;
  const completedCount = todos.filter((t) => t.completed).length;
  const pendingCount = totalCount - completedCount;

  // —— 四象限数据（来源与左侧列表同一份统一排序，确保两侧一致）——
  const quadrantData = useMemo(() => {
    const quadrants = {
      urgent_important: [],        // Q1 重要且紧急 右上
      urgent_not_important: [],    // Q2 紧急不重要 右下
      not_urgent_important: [],    // Q3 重要不紧急 左上
      not_urgent_not_important: [], // Q4 不重要不紧急 左下
    };

    displayTodos.forEach((t) => {
      if (quadrants[t.priority]) {
        quadrants[t.priority].push(t);
      } else {
        quadrants.not_urgent_not_important.push(t);
      }
    });

    return quadrants;
  }, [displayTodos]);

  // 每个象限的统计
  const quadrantCounts = useMemo(() => {
    const counts = {};
    Object.keys(quadrantData).forEach((key) => {
      counts[key] = {
        total: quadrantData[key].length,
        completed: quadrantData[key].filter((t) => t.completed).length,
      };
    });
    return counts;
  }, [quadrantData]);

  // 打开添加
  const handleOpenAdd = () => {
    setEditTodoItem(null);
    setDialogOpen(true);
  };

  const handleOpenEdit = (todo) => {
    setEditTodoItem(todo);
    setDialogOpen(true);
  };

  const handleSaveTodo = (data) => {
    if (editTodoItem) {
      editTodo(editTodoItem.id, data);
    } else {
      addTodo(data);
    }
    setDialogOpen(false);
    setEditTodoItem(null);
    refreshTodos();
  };

  // 待办完成：打开弹窗
  const handleRequestComplete = (todo) => {
    setCompletingTodo(todo);
    setCompleteDialogOpen(true);
  };

  // 待办完成确认
  const handleConfirmComplete = (extra) => {
    if (completingTodo) {
      toggleTodo(completingTodo.id, extra);
      setCompleteDialogOpen(false);
      setCompletingTodo(null);
      refreshTodos();
    }
  };

  // 编辑已完成记录：弹出对话框，预填已有数据
  const handleEditRecord = (todo) => {
    setRecordEditTodo({
      todo,
      existingRecord: {
        completedTime: todo.completedTime,
        review: todo.review || {},
      },
    });
    setRecordEditOpen(true);
  };

  // 确认保存编辑后的完成记录
  const handleConfirmEditRecord = (extra) => {
    if (recordEditTodo) {
      toggleTodo(recordEditTodo.todo.id, extra);
      setRecordEditOpen(false);
      setRecordEditTodo(null);
      refreshTodos();
    }
  };

  // 取消完成
  const handleCancelComplete = (id) => {
    toggleTodo(id);
    refreshTodos();
  };

  const [deleteId, setDeleteId] = useState(null);
  const handleDelete = (id) => {
    setDeleteId(id);
  };
  const confirmDelete = () => {
    if (deleteId) {
      deleteTodo(deleteId);
      refreshTodos();
    }
    setDeleteId(null);
  };

  // —— 拖拽排序 ——
  const handleDragStart = (idx) => { setDragIndex(idx); };
  const handleDragOver = (idx) => { setOverIndex(idx); };
  const handleDrop = (idx) => {
    if (dragIndex === null || dragIndex === idx) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }
    // 基于统一排序（displayTodos）计算新顺序，使左侧列表拖拽与四象限共用一套顺序
    const srcId = filteredDisplay[dragIndex]?.id;
    const dstId = filteredDisplay[idx]?.id;
    if (!srcId || !dstId) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }
    // 落点所在分组的优先级：跨组拖拽即把事项归入该象限
    const targetPriority = filteredDisplay[idx].priority;
    const all = [...displayTodos];
    const from = all.findIndex((t) => t.id === srcId);
    if (from === -1) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }
    const [moved] = all.splice(from, 1);
    let to = all.findIndex((t) => t.id === dstId);
    if (to === -1) to = all.length;
    all.splice(to, 0, moved);
    reorderTodos(all.map((t) => t.id)); // 新的全局 order
    if (moved.priority !== targetPriority) {
      editTodo(srcId, { priority: targetPriority }); // 跨组时更新象限归属
    }
    refreshTodos();
    setDragIndex(null);
    setOverIndex(null);
  };

  // —— 四象限拖拽（象限内排序 + 跨象限移动）——
  const [dragTodoId, setDragTodoId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // { priority, index }

  const resetQuadrantDrag = () => {
    setDragTodoId(null);
    setDropTarget(null);
  };

  const handleQuadrantDragStart = (id) => {
    setDragTodoId(id);
  };

  const handleQuadrantDragEnd = () => {
    resetQuadrantDrag();
  };

  // targetPriority: 落点象限；targetIndex: 落点在该象限内的位置（items.length 表示末尾）
  const handleQuadrantDrop = (targetPriority, targetIndex) => {
    const dragId = dragTodoId;
    resetQuadrantDrag();
    if (!dragId) return;
    const all = [...todos];
    const dragItem = all.find((t) => t.id === dragId);
    if (!dragItem) return;
    const without = all.filter((t) => t.id !== dragId);
    const targetItems = without.filter((t) => t.priority === targetPriority);
    let insertPos;
    if (targetItems.length === 0) {
      insertPos = without.length; // 空象限：放末尾
    } else if (targetIndex >= targetItems.length) {
      insertPos = without.findIndex((t) => t.id === targetItems[targetItems.length - 1].id) + 1; // 末尾之后
    } else {
      insertPos = without.findIndex((t) => t.id === targetItems[targetIndex].id); // 目标项之前
    }
    without.splice(insertPos, 0, { ...dragItem, priority: targetPriority });
    reorderTodos(without.map((t) => t.id)); // 按新全局顺序重排 order
    editTodo(dragId, { priority: targetPriority }); // 跨象限时更新象限归属
    refreshTodos();
  };

  // 点击象限标题：切换选中该象限的所有事项
  const handleQuadrantClick = (priority) => {
    setSelectedTodoId(null);
    setSelectedPriority(selectedPriority === priority ? null : priority);
  };

  // 点击象限中具体事项：仅高亮该事项并滚动
  const handleQuadrantItemClick = (todoId, priority) => {
    setSelectedPriority(null);    // 清除象限高亮
    setSelectedTodoId(todoId);    // 高亮具体事项
  };

  // 切换阶段完成状态
  const handleTogglePhase = (todoId, phaseId) => {
    toggleTodoPhase(todoId, phaseId);
    refreshTodos();
  };

  // 四象限布局（2×2网格）
  const quadrantLayout = [
    // 第一行：重要（上部）
    // 列顺序：不紧急 | 紧急
    { key: 'not_urgent_important', row: 0, col: 0 },     // Q3 左上：不紧急+重要
    { key: 'urgent_important', row: 0, col: 1 },          // Q1 右上：紧急+重要
    // 第二行：不重要（下部）
    { key: 'not_urgent_not_important', row: 1, col: 0 },  // Q4 左下：不紧急+不重要
    { key: 'urgent_not_important', row: 1, col: 1 },      // Q2 右下：紧急+不重要
  ];

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', md: 'row' },
        gap: 2,
        minHeight: '100%',
        px: 1.5,
        pt: 2,
        pb: 2,
        width: '100%',
      }}
    >
      {/* ============= 左侧：待办列表（1份） ============= */}
      <Box ref={leftListRef} sx={{ flex: 1, minWidth: 0, overflow: 'auto', px: 0.5, scrollbarGutter: 'stable' }}>
        <Typography variant="h4" sx={{ mb: 1, color: '#c9d1d9' }}>
          待办事项
        </Typography>

        {/* 统计概览 */}
        <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
          {[
            { label: '全部', count: totalCount, color: '#1f6feb' },
            { label: '待完成', count: pendingCount, color: '#d29922' },
            { label: '已完成', count: completedCount, color: '#3fb950' },
          ].map((s) => (
            <Box
              key={s.label}
              sx={{
                flex: 1,
                p: 1.5,
                bgcolor: '#161b22',
                borderRadius: '16px',
                border: '1px solid #30363d',
                textAlign: 'center',
              }}
            >
              <Typography variant="h5" sx={{ color: s.color, fontWeight: 700 }}>
                {s.count}
              </Typography>
              <Typography variant="caption" sx={{ color: '#6e7681' }}>
                {s.label}
              </Typography>
            </Box>
          ))}
        </Box>

        {/* 筛选 + 添加（同一行，四个方框统一尺寸与弧度） */}
        <Box sx={{ mb: 2, display: 'flex', alignItems: 'stretch', gap: 1.5, flexWrap: 'nowrap' }}>
          {[
            { key: 'all', label: '全部' },
            { key: 'pending', label: '待完成' },
            { key: 'completed', label: '已完成' },
          ].map((b) => {
            const active = filter === b.key;
            return (
              <Box
                key={b.key}
                onClick={() => setFilter(b.key)}
                sx={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: 40,
                  py: 1.25,
                  borderRadius: '16px',
                  border: '1px solid',
                  borderColor: active ? 'primary.main' : 'divider',
                  bgcolor: active ? 'rgba(77, 159, 255, 0.15)' : '#161b22',
                  color: active ? 'primary.main' : 'text.secondary',
                  fontWeight: active ? 700 : 500,
                  fontSize: '0.9rem',
                  textAlign: 'center',
                  cursor: 'pointer',
                  userSelect: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s',
                  '&:hover': {
                    borderColor: active ? 'primary.main' : 'text.secondary',
                    bgcolor: active ? 'rgba(31, 111, 235, 0.2)' : '#21262d',
                  },
                }}
              >
                {b.label}
              </Box>
            );
          })}
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleOpenAdd}
            sx={{
              flex: 1,
              minHeight: 40,
              bgcolor: 'primary.main',
              '&:hover': { bgcolor: 'primary.dark' },
              fontWeight: 600,
              whiteSpace: 'nowrap',
              borderRadius: '16px',
            }}
          >
            添加待办
          </Button>
        </Box>

        {/* 待办列表（按统一排序分组展示：Q1→Q2→Q3→Q4，每组内按 order） */}
        {filteredDisplay.length > 0 ? (
          <Box>
            {GROUP_ORDER.map((key) => {
              const groupItems = filteredDisplay.filter((t) => t.priority === key);
              if (groupItems.length === 0) return null;
              const cfg = TODO_PRIORITIES[key];
              return (
                <Box key={key} sx={{ mb: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mb: 0.5, px: 0.5 }}>
                    <Box sx={{ width: 3, height: 13, borderRadius: '16px', bgcolor: cfg.color, flexShrink: 0 }} />
                    <Typography variant="caption" sx={{ color: cfg.color, fontWeight: 700, fontSize: '0.75rem' }}>
                      {GROUP_LABELS[key]}
                    </Typography>
                    <Typography variant="caption" sx={{ color: '#6e7681', fontSize: '0.7rem' }}>
                      {groupItems.length}
                    </Typography>
                  </Box>
                  {groupItems.map((todo) => {
                    const gi = filteredDisplay.findIndex((t) => t.id === todo.id);
                    return (
                      <TodoCard
                        key={todo.id}
                        todo={todo}
                        onRequestComplete={handleRequestComplete}
                        onCancelComplete={handleCancelComplete}
                        onEdit={handleOpenEdit}
                        onDelete={handleDelete}
                        onEditRecord={handleEditRecord}
                        sidebarSelected={selectedTodoId === todo.id || selectedPriority === todo.priority}
                        index={gi}
                        onDragStart={handleDragStart}
                        onDragOver={handleDragOver}
                        onDrop={handleDrop}
                        onTogglePhase={handleTogglePhase}
                      />
                    );
                  })}
                </Box>
              );
            })}
          </Box>
        ) : (
          <Box sx={{ textAlign: 'center', py: 6, color: '#6e7681' }}>
            <Typography variant="body1" sx={{ mb: 1 }}>
              {filter === 'all' ? '还没有待办事项' : filter === 'pending' ? '没有待完成的待办' : '没有已完成的待办'}
            </Typography>
            <Typography variant="body2" sx={{ color: '#484f58' }}>
              点击下方按钮添加待办
            </Typography>
          </Box>
        )}

        <AddTodoDialog
          open={dialogOpen}
          onClose={() => { setDialogOpen(false); setEditTodoItem(null); }}
          onSave={handleSaveTodo}
          editTodo={editTodoItem}
        />

        <TodoCompleteDialog
          open={completeDialogOpen}
          onClose={() => { setCompleteDialogOpen(false); setCompletingTodo(null); }}
          onConfirm={handleConfirmComplete}
          todo={completingTodo}
        />

        <TodoCompleteDialog
          open={recordEditOpen}
          onClose={() => { setRecordEditOpen(false); setRecordEditTodo(null); }}
          onConfirm={handleConfirmEditRecord}
          todo={recordEditTodo && recordEditTodo.todo}
          existingRecord={recordEditTodo && recordEditTodo.existingRecord}
        />

        <ConfirmDialog
          open={!!deleteId}
          title="删除待办事项"
          message="确定要删除这个待办事项吗？其包含的 STAR 描述、行动清单与复盘内容都将一并删除，且无法恢复。"
          onConfirm={confirmDelete}
          onClose={() => setDeleteId(null)}
        />
      </Box>

      {/* ============= 右侧：四象限矩阵（2份） ============= */}
      <Box
        sx={{
          flex: 2,
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'auto',
          px: 0.5,
          borderLeft: { md: '1px solid #30363d' },
          pl: { md: 2 },
        }}
      >
        <Typography variant="h4" sx={{ mb: 2, color: '#c9d1d9' }}>
          四象限清单
        </Typography>

        {/* 四象限矩阵（2×2 网格；行均分剩余高度填满，象限各自内部滚动） */}
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gridTemplateRows: 'auto auto',
            alignContent: 'start',
            gap: 1,
          }}
        >
          {/* 四个象限 */}
          {quadrantLayout.map(({ key, row, col }) => {
            const cfg = TODO_PRIORITIES[key];
            const items = quadrantData[key] || [];
            const counts = quadrantCounts[key] || { total: 0, completed: 0 };
            const isSelected = selectedPriority === key;

            return (
              <Box
                key={key}
                onClick={() => handleQuadrantClick(key)}
                sx={{
                  bgcolor: isSelected ? `${cfg.bg}` : '#0d1117',
                  border: '2px solid',
                  borderColor: isSelected ? cfg.color : '#30363d',
                  borderRadius: '16px',
                  p: 1.25,
                  minHeight: 116,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  overflow: 'auto',
                  scrollbarGutter: 'stable',
                  '&:hover': {
                    borderColor: cfg.color,
                    bgcolor: cfg.bg,
                  },
                }}
              >
                {/* 象限标题 */}
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                  <Typography
                    variant="body2"
                    sx={{
                      color: cfg.color,
                      fontWeight: 700,
                      fontSize: '0.85rem',
                    }}
                  >
                    {cfg.label}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      color: '#6e7681',
                      fontSize: '0.75rem',
                      fontWeight: 500,
                    }}
                  >
                    {counts.completed}/{counts.total}
                  </Typography>
                </Box>

                {/* 象限内事项列表 */}
                {items.length === 0 ? (
                  <Box
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropTarget({ priority: key, index: 0 }); }}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleQuadrantDrop(key, 0); }}
                    sx={{
                      color: '#484f58',
                      fontStyle: 'italic',
                      fontSize: '0.75rem',
                      textAlign: 'center',
                      py: 2,
                      borderRadius: '16px',
                      border: dropTarget && dropTarget.priority === key ? '1.5px dashed #1f6feb' : '1.5px dashed transparent',
                      transition: 'border 0.15s, background 0.15s',
                    }}
                  >
                    暂无事项（可拖入）
                  </Box>
                ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {items.slice(0, 15).map((t, idx) => {
                      const isDragging = dragTodoId === t.id;
                      const isDrop = dropTarget && dropTarget.priority === key && dropTarget.index === idx;
                      return (
                      <Box
                        key={t.id}
                        draggable
                        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; handleQuadrantDragStart(t.id); }}
                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropTarget({ priority: key, index: idx }); }}
                        onDragEnd={handleQuadrantDragEnd}
                        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleQuadrantDrop(key, idx); }}
                        sx={{
                          p: 0.75,
                          borderRadius: '16px',
                          bgcolor: t.completed ? 'rgba(0,230,118,0.08)' : 'rgba(255,255,255,0.03)',
                          borderLeft: '2px solid',
                          borderLeftColor: t.completed ? '#3fb950' : cfg.color,
                          border: isDrop ? '1.5px dashed #1f6feb' : '1.5px solid transparent',
                          opacity: isDragging ? 0.4 : (t.completed ? 0.65 : 1),
                          cursor: 'grab',
                          transition: 'background 0.15s, opacity 0.15s, border 0.15s',
                          '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' },
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleQuadrantItemClick(t.id, key);
                        }}
                      >
                        <Typography
                          variant="body2"
                          sx={{
                            color: t.completed ? '#6e7681' : '#c9d1d9',
                            fontSize: '0.85rem',
                            fontWeight: 500,
                            textDecoration: t.completed ? 'line-through' : 'none',
                            display: 'block',
                            lineHeight: 1.3,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {t.title}
                        </Typography>
                        {t.dueDate && (
                          <Typography
                            variant="caption"
                            sx={{
                              color: !t.completed && new Date(t.dueDate) < new Date(new Date().toDateString())
                                ? '#f85149' : '#8b949e',
                              fontSize: '0.7rem',
                              display: 'block',
                              mt: 0.3,
                            }}
                          >
                            📅 {t.dueDate}
                          </Typography>
                        )}
                      </Box>
                      );
                    })}
                    {items.length > 15 && (
                      <Typography variant="caption" sx={{ color: '#6e7681', fontSize: '0.7rem', textAlign: 'center' }}>
                        +{items.length - 15} 项
                      </Typography>
                    )}
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}

export default TodoPage;

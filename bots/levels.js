/*
 * Difficulty levels for "Đấu với máy". Names/descriptions are shown in the UI, so they are in Vietnamese.
 *   1 Dễ   greedy (1 ply) with randomness – blocks fours, misses deeper threats
 *   2 Vừa  search, depth 2 + short VCF (4 plies), narrower – always its best move at that depth (no randomness:
 *          user, 2026-11-17 – weaker by seeing less, not by choosing worse moves on purpose)
 *   3 Khó  full search (≈ 1.5 s at most, node budget)
 */
CaroBots.module(function (root) {
  'use strict';
  const Bots = root.CaroBots;
  Bots.variant('greedy', {
    id: 'level-1', name: 'Máy (Dễ)', level: 1, levelName: 'Dễ',
    description: 'Chỉ nhìn nước hiện tại, hay đi nước chưa tốt. Hợp với người mới chơi.',
    params: { randomness: 0.5, top: 5 },
  });
  Bots.variant('search', {
    id: 'level-2', name: 'Máy (Vừa)', level: 2, levelName: 'Vừa',
    description: 'Tính trước 2 nước và các chuỗi nước bốn ngắn.',
    params: { depth: 2, width: 6, rootWidth: 10, qPly: 4 },
  });
  Bots.variant('search', {
    id: 'level-3', name: 'Máy (Khó)', level: 3, levelName: 'Khó',
    description: 'Tính sâu nhất có thể trong khoảng 1,5 giây, luôn xét các chuỗi tấn công liên tục.',
    params: {},
  });
});

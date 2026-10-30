import { performanceIndex } from './performance-index';

const W = { attendance: 20, quiz: 40, labs: 40 };

describe('performance index (OI-42)', () => {
  it('weights attendance 20, quiz 40, labs 40', () => {
    expect(performanceIndex({ attendance: 100, quiz: 50, labs: 25 }, W)).toBe(50); // 20 + 20 + 10
    expect(performanceIndex({ attendance: 50, quiz: 100, labs: 100 }, W)).toBe(90);
  });

  it('leaves out parts without data and scales the rest', () => {
    expect(performanceIndex({ attendance: 100, quiz: null, labs: null }, W)).toBe(100);
    expect(performanceIndex({ attendance: 40, quiz: 70, labs: null }, W)).toBe(60); // (800 + 2800) / 60
  });

  it('is null when nothing is recorded, and ignores a part weighted 0', () => {
    expect(performanceIndex({ attendance: null, quiz: null, labs: null }, W)).toBeNull();
    expect(performanceIndex({ attendance: 10, quiz: 90, labs: null }, { attendance: 0, quiz: 50, labs: 50 })).toBe(90);
  });
});

import { shouldSuggestEndShowInsteadOfPreshow } from './rosProgramTypeSplit';

function row(
  id: number,
  programType: string,
  extra: { day?: number; isTimedMarker?: boolean; isIndented?: boolean } = {}
) {
  return { id, programType, day: extra.day ?? 1, ...extra };
}

describe('shouldSuggestEndShowInsteadOfPreshow', () => {
  it('does not warn for stacked PreShows at the top', () => {
    const schedule = [
      row(1, 'PreShow'),
      row(2, 'PreShow'),
      row(3, 'PreShow'),
    ];
    expect(
      shouldSuggestEndShowInsteadOfPreshow(schedule, { itemId: 3 })
    ).toBe(false);
  });

  it('ignores Timed Markers between PreShows', () => {
    const schedule = [
      row(1, 'PreShow'),
      row(2, 'NOC', { isTimedMarker: true }),
      row(3, 'NOC', { isTimedMarker: true }),
      row(4, 'NOC', { isTimedMarker: true }),
      row(5, 'Transition'),
    ];
    expect(
      shouldSuggestEndShowInsteadOfPreshow(schedule, { itemId: 5, atIndex: 5 })
    ).toBe(false);
    // setting PreShow on a new row after only 1 regular cue
    expect(
      shouldSuggestEndShowInsteadOfPreshow(
        [...schedule, row(6, '')],
        { itemId: 6 }
      )
    ).toBe(false);
  });

  it('warns when many regular cues follow the first PreShow', () => {
    const schedule = [
      row(1, 'PreShow'),
      row(2, 'Keynote'),
      row(3, 'Panel'),
      row(4, 'Break F&B/B2B'),
      row(5, 'Panel'),
    ];
    expect(
      shouldSuggestEndShowInsteadOfPreshow(schedule, { itemId: 5 })
    ).toBe(true);
  });

  it('allows PreShow again after a Show Break', () => {
    const schedule = [
      row(1, 'PreShow'),
      row(2, 'Keynote'),
      row(3, 'Panel'),
      row(4, 'Break F&B/B2B'),
      row(5, 'Show Break'),
      row(6, 'Transition'),
    ];
    expect(
      shouldSuggestEndShowInsteadOfPreshow(schedule, {
        atIndex: schedule.length,
        day: 1,
      })
    ).toBe(false);
  });
});

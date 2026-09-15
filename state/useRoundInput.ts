import { useState } from 'react';
import { DEFAULT_TOTAL_ROUNDS } from '../constants';

// Round count input shared by the lobby, single-player and name-entry screens.
// Behaviour is unchanged from the original inline handlers: soft-commit while
// typing so "10" isn't forced through "1", strict clamp on blur.
export const useRoundInput = () => {
  const [selectedTotalRounds, setSelectedTotalRounds] = useState(DEFAULT_TOTAL_ROUNDS);
  const [roundsInput, setRoundsInput] = useState(DEFAULT_TOTAL_ROUNDS.toString());

  const handleRoundInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setRoundsInput(val);

    // Soft commit valid numbers immediately so buttons/state are reactive, but don't force it
    // This allows "10" to be typed without being forced to "1" intermediate
    const num = parseInt(val, 10);
    if (!isNaN(num) && num >= 1 && num <= 100) {
      setSelectedTotalRounds(num);
    }
  };

  const handleRoundInputBlur = () => {
    let val = parseInt(roundsInput, 10);
    // Apply strict validation on blur (focus loss)
    if (isNaN(val) || val < 1) val = 1;
    if (val > 100) val = 100;

    setSelectedTotalRounds(val);
    setRoundsInput(val.toString());
  };

  const handleRoundInputFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.select();
  };

  const setRoundsAndSync = (r: number) => {
    setSelectedTotalRounds(r);
    setRoundsInput(r.toString());
  };

  return {
    selectedTotalRounds,
    setSelectedTotalRounds,
    roundsInput,
    handleRoundInputChange,
    handleRoundInputBlur,
    handleRoundInputFocus,
    setRoundsAndSync
  };
};

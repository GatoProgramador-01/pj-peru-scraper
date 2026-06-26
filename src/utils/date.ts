export const normDate = (raw: string): string => {
  const m = raw.trim().match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : raw.trim();
};

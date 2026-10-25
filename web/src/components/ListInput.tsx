export function ListInput({
  id,
  label,
  hint,
  values,
  max,
  placeholder,
  addLabel,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  values: string[];
  max: number;
  placeholder?: string;
  addLabel: string;
  onChange: (next: string[]) => void;
}) {
  const rows = values.length === 0 ? [''] : values;
  const set = (index: number, value: string) =>
    onChange(rows.map((row, i) => (i === index ? value : row)));
  const remove = (index: number) => onChange(rows.filter((_, i) => i !== index));
  return (
    <fieldset className="field">
      <legend>{label}</legend>
      {hint ? (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      <div className="list-input">
        {rows.map((row, index) => (
          <div className="row" key={index}>
            <input
              id={`${id}-${index}`}
              type="text"
              value={row}
              maxLength={140}
              placeholder={placeholder}
              aria-label={`${label}, entry ${index + 1}`}
              {...(hint ? { 'aria-describedby': `${id}-hint` } : {})}
              onChange={(event) => set(index, event.target.value)}
            />
            {rows.length > 1 || row !== '' ? (
              <button type="button" className="btn small" onClick={() => remove(index)}>
                Remove<span className="visually-hidden"> entry {index + 1}</span>
              </button>
            ) : null}
          </div>
        ))}
        {rows.length < max ? (
          <div>
            <button type="button" className="btn small" onClick={() => onChange([...rows, ''])}>
              {addLabel}
            </button>
          </div>
        ) : null}
      </div>
    </fieldset>
  );
}

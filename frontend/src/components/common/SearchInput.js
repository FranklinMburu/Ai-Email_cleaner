import React, { useState } from 'react';

/**
 * SearchInput - Searchable input field with debouncing
 */
export const SearchInput = ({ onSearch, placeholder = 'Search...', debounceMs = 300 }) => {
  const [value, setValue] = useState('');
  const [timeoutId, setTimeoutId] = React.useState(null);

  const handleChange = (e) => {
    const newValue = e.target.value;
    setValue(newValue);

    // Clear previous timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    // Set new timeout for debounced search
    const id = setTimeout(() => {
      onSearch(newValue);
    }, debounceMs);

    setTimeoutId(id);
  };

  const handleClear = () => {
    setValue('');
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    onSearch('');
  };

  return (
    <div className="search-input">
      <input
        type="text"
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        className="search-field"
      />
      {value && (
        <button className="search-clear" onClick={handleClear} title="Clear search">
          ×
        </button>
      )}
      <span className="search-icon">🔍</span>
    </div>
  );
};

export default SearchInput;

import React from 'react';
import { getPaginationRange } from '../../utils/pagination';

/**
 * Pagination - Display pagination controls
 */
export const Pagination = ({ currentPage = 1, totalPages, onPageChange, itemsPerPage }) => {
  if (totalPages <= 1) return null;

  const { pages, showFirst, showLast, hasPrev, hasNext } = getPaginationRange(
    currentPage,
    totalPages,
    5
  );

  return (
    <div className="pagination">
      {hasPrev && (
        <button
          className="pagination-button"
          onClick={() => onPageChange(1)}
          title="First page"
        >
          «
        </button>
      )}

      {hasPrev && (
        <button
          className="pagination-button"
          onClick={() => onPageChange(currentPage - 1)}
          title="Previous page"
        >
          ‹
        </button>
      )}

      {pages.map((page) => (
        <button
          key={page}
          className={`pagination-button ${currentPage === page ? 'active' : ''}`}
          onClick={() => onPageChange(page)}
        >
          {page}
        </button>
      ))}

      {hasNext && (
        <button
          className="pagination-button"
          onClick={() => onPageChange(currentPage + 1)}
          title="Next page"
        >
          ›
        </button>
      )}

      {hasNext && (
        <button
          className="pagination-button"
          onClick={() => onPageChange(totalPages)}
          title="Last page"
        >
          »
        </button>
      )}

      <span className="pagination-info">
        Page {currentPage} of {totalPages}
      </span>
    </div>
  );
};

export default Pagination;

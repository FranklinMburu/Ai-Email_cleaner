/**
 * Pagination helper utilities
 */

export const paginate = (items, pageNumber = 1, pageSize = 10) => {
  const startIndex = (pageNumber - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  return items.slice(startIndex, endIndex);
};

export const getTotalPages = (itemCount, pageSize = 10) => {
  return Math.ceil(itemCount / pageSize);
};

export const getPaginationRange = (currentPage, totalPages, maxButtons = 5) => {
  let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  
  if (endPage - startPage < maxButtons - 1) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }
  
  const pages = [];
  for (let i = startPage; i <= endPage; i++) {
    pages.push(i);
  }
  
  return {
    pages,
    showFirst: startPage > 1,
    showLast: endPage < totalPages,
    hasPrev: currentPage > 1,
    hasNext: currentPage < totalPages,
  };
};

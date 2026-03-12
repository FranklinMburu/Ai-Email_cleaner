import React, { useState } from 'react';
import { useNotifications } from '../../hooks/useNotifications';

/**
 * ScheduledReview - Simple scheduled review UI
 * Allows users to schedule periodic reviews without auto-execution
 */
export function ScheduledReview() {
  const notifications = useNotifications();
  const [nextReviewTime, setNextReviewTime] = useState(null);
  const [reviewInterval, setReviewInterval] = useState('weekly');
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [selectedTime, setSelectedTime] = useState('09:00');

  const handleScheduleReview = () => {
    // Calculate next review time based on interval
    const now = new Date();
    let nextTime = new Date(now);

    switch (reviewInterval) {
      case 'daily':
        nextTime.setDate(nextTime.getDate() + 1);
        break;
      case 'weekly':
        nextTime.setDate(nextTime.getDate() + 7);
        break;
      case 'monthly':
        nextTime.setMonth(nextTime.getMonth() + 1);
        break;
      default:
        nextTime.setDate(nextTime.getDate() + 7);
    }

    // Set the time
    const [hours, minutes] = selectedTime.split(':');
    nextTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);

    setNextReviewTime(nextTime);
    setShowScheduleForm(false);
    notifications.success(`Review scheduled for ${nextTime.toLocaleString()}`);
  };

  const handleCancelSchedule = () => {
    setNextReviewTime(null);
    notifications.success('Scheduled review cancelled');
  };

  const formatTimeUntilReview = (reviewTime) => {
    const now = new Date();
    const diff = reviewTime - now;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      return `in ${days} day${days !== 1 ? 's' : ''} at ${reviewTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } else if (hours > 0) {
      return `in ${hours} hour${hours !== 1 ? 's' : ''} at ${reviewTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } else {
      return `very soon`;
    }
  };

  return (
    <div className="scheduled-review card">
      <div className="card-header">
        <div>
          <h3 className="card-title">Scheduled Review</h3>
          <p className="card-subtitle">Set up periodic reminders to review your inbox cleanup recommendations</p>
        </div>
      </div>

      <div className="card-content">
        {nextReviewTime ? (
          <div className="scheduled-info">
            <div className="review-status">
              <strong>Next Review:</strong> {formatTimeUntilReview(nextReviewTime)}
            </div>
            <p className="review-details">
              A reminder will appear when it's time to review cleanup recommendations.
              No automatic actions will be taken.
            </p>
            <div className="review-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowScheduleForm(!showScheduleForm)}
              >
                {showScheduleForm ? '▼ Change Schedule' : '▶ Change Schedule'}
              </button>
              <button
                className="btn btn-danger"
                onClick={handleCancelSchedule}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="no-schedule">
            <p>No review scheduled yet.</p>
            <button
              className="btn btn-primary"
            onClick={() => setShowScheduleForm(!showScheduleForm)}
          >
            {showScheduleForm ? '▼ Schedule Review' : '▶ Schedule Review'}
          </button>
        </div>
      )}

      {showScheduleForm && (
        <div className="schedule-form">
          <div className="form-group">
            <label>Frequency:</label>
            <select
              value={reviewInterval}
              onChange={(e) => setReviewInterval(e.target.value)}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>

          <div className="form-group">
            <label>Time:</label>
            <input
              type="time"
              value={selectedTime}
              onChange={(e) => setSelectedTime(e.target.value)}
            />
          </div>

          <div className="form-actions">
            <button
              className="btn btn-primary"
              onClick={handleScheduleReview}
            >
              Schedule
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => setShowScheduleForm(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

export default ScheduledReview;

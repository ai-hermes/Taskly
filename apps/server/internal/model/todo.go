package model

import "time"

type Todo struct {
	ID          string    `json:"id" gorm:"primaryKey"`
	Title       string    `json:"title" gorm:"not null"`
	Description string    `json:"description"`
	Done        bool      `json:"done" gorm:"default:false"`
	Source      string    `json:"source"`      // e.g., "wechat_ocr"
	SourceText  string    `json:"source_text"` // original OCR text
	Priority    int       `json:"priority" gorm:"default:0"`
	DueDate     *time.Time `json:"due_date"`
	UserID      string    `json:"user_id" gorm:"index"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type SyncPayload struct {
	Todos     []Todo `json:"todos"`
	Timestamp int64  `json:"timestamp"`
	DeviceID  string `json:"device_id"`
}

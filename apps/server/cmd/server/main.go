package main

import (
	"log"

	"github.com/ai-hermes/Taskly/apps/server/internal/config"
	"github.com/ai-hermes/Taskly/apps/server/internal/handler"
	"github.com/gin-gonic/gin"
)

func main() {
	cfg := config.Load()

	r := gin.Default()

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// API v1
	v1 := r.Group("/api/v1")
	{
		todos := v1.Group("/todos")
		{
			todos.GET("", handler.ListTodos)
			todos.POST("", handler.CreateTodo)
			todos.GET("/:id", handler.GetTodo)
			todos.PUT("/:id", handler.UpdateTodo)
			todos.DELETE("/:id", handler.DeleteTodo)
		}

		sync := v1.Group("/sync")
		{
			sync.POST("/push", handler.SyncPush)
			sync.GET("/pull", handler.SyncPull)
		}
	}

	log.Printf("Server starting on %s", cfg.Addr)
	if err := r.Run(cfg.Addr); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

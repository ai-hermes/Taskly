package handler

import (
	"net/http"

	"github.com/ai-hermes/Taskly/apps/server/internal/model"
	"github.com/gin-gonic/gin"
)

// In-memory store for now (will be replaced with PostgreSQL)
var todoStore = make(map[string]model.Todo)

func ListTodos(c *gin.Context) {
	todos := make([]model.Todo, 0, len(todoStore))
	for _, t := range todoStore {
		todos = append(todos, t)
	}
	c.JSON(http.StatusOK, gin.H{"todos": todos})
}

func CreateTodo(c *gin.Context) {
	var todo model.Todo
	if err := c.ShouldBindJSON(&todo); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	todoStore[todo.ID] = todo
	c.JSON(http.StatusCreated, todo)
}

func GetTodo(c *gin.Context) {
	id := c.Param("id")
	todo, ok := todoStore[id]
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "todo not found"})
		return
	}
	c.JSON(http.StatusOK, todo)
}

func UpdateTodo(c *gin.Context) {
	id := c.Param("id")
	if _, ok := todoStore[id]; !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "todo not found"})
		return
	}

	var todo model.Todo
	if err := c.ShouldBindJSON(&todo); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	todo.ID = id
	todoStore[id] = todo
	c.JSON(http.StatusOK, todo)
}

func DeleteTodo(c *gin.Context) {
	id := c.Param("id")
	if _, ok := todoStore[id]; !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "todo not found"})
		return
	}
	delete(todoStore, id)
	c.JSON(http.StatusNoContent, nil)
}

func SyncPush(c *gin.Context) {
	var payload model.SyncPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	for _, todo := range payload.Todos {
		todoStore[todo.ID] = todo
	}

	c.JSON(http.StatusOK, gin.H{"synced": len(payload.Todos)})
}

func SyncPull(c *gin.Context) {
	todos := make([]model.Todo, 0, len(todoStore))
	for _, t := range todoStore {
		todos = append(todos, t)
	}
	c.JSON(http.StatusOK, model.SyncPayload{
		Todos: todos,
	})
}

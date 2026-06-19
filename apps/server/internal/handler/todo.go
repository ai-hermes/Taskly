package handler

import (
	"net/http"
	"sync"

	"github.com/ai-hermes/Taskly/apps/server/internal/model"
	"github.com/gin-gonic/gin"
)

// In-memory store for now (will be replaced with PostgreSQL)
var (
	todoStore = make(map[string]model.Todo)
	storeMu   sync.RWMutex
)

func ListTodos(c *gin.Context) {
	storeMu.RLock()
	todos := make([]model.Todo, 0, len(todoStore))
	for _, t := range todoStore {
		todos = append(todos, t)
	}
	storeMu.RUnlock()
	c.JSON(http.StatusOK, gin.H{"todos": todos})
}

func CreateTodo(c *gin.Context) {
	var todo model.Todo
	if err := c.ShouldBindJSON(&todo); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	storeMu.Lock()
	todoStore[todo.ID] = todo
	storeMu.Unlock()
	c.JSON(http.StatusCreated, todo)
}

func GetTodo(c *gin.Context) {
	id := c.Param("id")
	storeMu.RLock()
	todo, ok := todoStore[id]
	storeMu.RUnlock()
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "todo not found"})
		return
	}
	c.JSON(http.StatusOK, todo)
}

func UpdateTodo(c *gin.Context) {
	id := c.Param("id")
	storeMu.RLock()
	if _, ok := todoStore[id]; !ok {
		storeMu.RUnlock()
		c.JSON(http.StatusNotFound, gin.H{"error": "todo not found"})
		return
	}
	storeMu.RUnlock()

	var todo model.Todo
	if err := c.ShouldBindJSON(&todo); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	todo.ID = id
	storeMu.Lock()
	todoStore[id] = todo
	storeMu.Unlock()
	c.JSON(http.StatusOK, todo)
}

func DeleteTodo(c *gin.Context) {
	id := c.Param("id")
	storeMu.RLock()
	if _, ok := todoStore[id]; !ok {
		storeMu.RUnlock()
		c.JSON(http.StatusNotFound, gin.H{"error": "todo not found"})
		return
	}
	storeMu.RUnlock()
	storeMu.Lock()
	delete(todoStore, id)
	storeMu.Unlock()
	c.JSON(http.StatusNoContent, nil)
}

func SyncPush(c *gin.Context) {
	var payload model.SyncPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	storeMu.Lock()
	for _, todo := range payload.Todos {
		todoStore[todo.ID] = todo
	}
	storeMu.Unlock()

	c.JSON(http.StatusOK, gin.H{"synced": len(payload.Todos)})
}

func SyncPull(c *gin.Context) {
	storeMu.RLock()
	todos := make([]model.Todo, 0, len(todoStore))
	for _, t := range todoStore {
		todos = append(todos, t)
	}
	storeMu.RUnlock()
	c.JSON(http.StatusOK, model.SyncPayload{
		Todos: todos,
	})
}

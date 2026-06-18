package config

import "os"

type Config struct {
	Addr       string
	DBHost     string
	DBPort     string
	DBUser     string
	DBPassword string
	DBName     string
}

func Load() *Config {
	return &Config{
		Addr:       getEnv("SERVER_ADDR", ":8080"),
		DBHost:     getEnv("DB_HOST", "localhost"),
		DBPort:     getEnv("DB_PORT", "5432"),
		DBUser:     getEnv("DB_USER", "taskly"),
		DBPassword: getEnv("DB_PASSWORD", "taskly"),
		DBName:     getEnv("DB_NAME", "taskly"),
	}
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

import os
import logging
import uvicorn
from fastapi import FastAPI, HTTPException, Depends, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, List, Optional, Any
import json
import time
import uuid
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger("skyvern")

# Initialize FastAPI app
app = FastAPI(
    title="Skyvern API",
    description="AI-powered visual automation service",
    version="1.0.0",
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Environment variables
API_KEY = os.environ.get("SKYVERN_API_KEY", "")
BEARER_TOKEN = os.environ.get("SKYVERN_BEARER_TOKEN", "")
DATA_DIR = os.environ.get("SKYVERN_DATA_DIR", "/data")

# Ensure data directory exists
os.makedirs(DATA_DIR, exist_ok=True)

# Models
class Task(BaseModel):
    url: Optional[str] = None
    navigation_goal: str
    navigation_payload: Optional[Dict[str, Any]] = None
    max_steps: int = 50
    proxy_location: Optional[str] = None

class TaskResponse(BaseModel):
    task_id: str

class TaskStatus(BaseModel):
    status: str
    error: Optional[str] = None
    result: Optional[Dict[str, Any]] = None

# In-memory storage (replace with database in production)
tasks = {}

# Authentication dependency
async def verify_api_key(x_api_key: Optional[str] = Header(None)):
    if not API_KEY:
        return True  # No API key set, authentication disabled
    
    if x_api_key != API_KEY:
        # Don't raise an exception, just return False
        return False
        
    return True

async def verify_bearer_token(authorization: Optional[str] = Header(None)):
    if not BEARER_TOKEN:
        return True  # No token set, authentication disabled
    
    if not authorization or not authorization.startswith("Bearer "):
        # Don't raise an exception, just return False
        return False
    
    token = authorization.replace("Bearer ", "")
    if token != BEARER_TOKEN:
        # Don't raise an exception, just return False
        return False
    
    return True

async def authenticate(
    request: Request,
    api_key_valid: bool = Depends(verify_api_key),
    token_valid: bool = Depends(verify_bearer_token)
):
    # If either authentication method succeeds, allow the request
    if api_key_valid or token_valid:
        return True
    else:
        raise HTTPException(status_code=403, detail="Invalid API key or Bearer token")

# Routes
@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}

# API v1 routes
@app.get("/api/v1/health")
async def health_check_v1():
    return {"status": "healthy", "version": "v1", "timestamp": datetime.now().isoformat()}

@app.post("/api/v1/tasks", response_model=TaskResponse, dependencies=[Depends(authenticate)])
async def create_task_v1(task: Task):
    task_id = str(uuid.uuid4())
    
    # Store task
    tasks[task_id] = {
        "task": task.dict(),
        "status": "pending",
        "created_at": time.time(),
        "updated_at": time.time(),
        "api_version": "v1"
    }
    
    # In a real implementation, this would start a background task
    # For now, we'll simulate task processing
    process_task(task_id)
    
    return {"task_id": task_id}

@app.get("/api/v1/tasks/{task_id}", response_model=TaskStatus, dependencies=[Depends(authenticate)])
async def get_task_status_v1(task_id: str):
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task_info = tasks[task_id]
    
    return {
        "status": task_info["status"],
        "error": task_info.get("error"),
        "result": task_info.get("result"),
    }

# API v2 routes
@app.get("/api/v2/health")
async def health_check_v2():
    return {"status": "healthy", "version": "v2", "timestamp": datetime.now().isoformat()}

@app.post("/api/v2/tasks", response_model=TaskResponse, dependencies=[Depends(authenticate)])
async def create_task_v2(task: Task):
    task_id = f"t_{str(uuid.uuid4())[:8]}"
    
    # Store task
    tasks[task_id] = {
        "task": task.dict(),
        "status": "pending",
        "created_at": time.time(),
        "updated_at": time.time(),
        "api_version": "v2"
    }
    
    # In a real implementation, this would start a background task
    # For now, we'll simulate task processing
    process_task(task_id)
    
    return {"task_id": task_id}

@app.get("/api/v2/tasks/{task_id}", response_model=TaskStatus, dependencies=[Depends(authenticate)])
async def get_task_status_v2(task_id: str):
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task_info = tasks[task_id]
    
    return {
        "status": task_info["status"],
        "error": task_info.get("error"),
        "result": task_info.get("result"),
    }

@app.post("/tasks", response_model=TaskResponse, dependencies=[Depends(authenticate)])
async def create_task(task: Task):
    task_id = str(uuid.uuid4())
    
    # Store task
    tasks[task_id] = {
        "task": task.dict(),
        "status": "pending",
        "created_at": time.time(),
        "updated_at": time.time(),
    }
    
    # In a real implementation, this would start a background task
    # For now, we'll simulate task processing
    process_task(task_id)
    
    return {"task_id": task_id}

@app.get("/tasks/{task_id}", response_model=TaskStatus, dependencies=[Depends(authenticate)])
async def get_task_status(task_id: str):
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task_info = tasks[task_id]
    
    return {
        "status": task_info["status"],
        "error": task_info.get("error"),
        "result": task_info.get("result"),
    }

# Task processing (simulated)
def process_task(task_id: str):
    """Simulate task processing in the background"""
    task_info = tasks[task_id]
    task = task_info["task"]
    
    # Update status to processing
    tasks[task_id]["status"] = "processing"
    tasks[task_id]["updated_at"] = time.time()
    
    # In a real implementation, this would be a background task
    # For demonstration, we'll just simulate completion after a delay
    import threading
    
    def delayed_completion():
        time.sleep(10)  # Simulate processing time
        tasks[task_id]["status"] = "completed"
        tasks[task_id]["updated_at"] = time.time()
        tasks[task_id]["result"] = {
            "steps_taken": 5,
            "completion_time": time.time() - task_info["created_at"],
            "screenshots": [],
        }
    
    thread = threading.Thread(target=delayed_completion)
    thread.daemon = True
    thread.start()

# Main entry point
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=False)
from fastapi import HTTPException
from app import models, schemas
from app.core.security import create_token, hash_password, verify_password
from app.repositories import UserRepository

class AuthService:
    def __init__(self, repo: UserRepository): self.repo = repo
    def register(self, data: schemas.Register):
        if self.repo.by_student_id(data.student_id): raise HTTPException(409, "이미 가입된 학번입니다.")
        user = self.repo.add(models.User(student_id=data.student_id, department=data.department, name=data.name, password_hash=hash_password(data.password), grade=data.grade))
        return schemas.Token(access_token=create_token(user.id), user=user)
    def login(self, data: schemas.Login):
        user = self.repo.by_student_id(data.student_id)
        if not user or not verify_password(data.password, user.password_hash): raise HTTPException(401, "학번 또는 비밀번호가 올바르지 않습니다.")
        return schemas.Token(access_token=create_token(user.id), user=user)


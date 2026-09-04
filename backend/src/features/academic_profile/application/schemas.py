"""Request/response models for the academic profile API (FR1)."""

from __future__ import annotations

from pydantic import BaseModel, Field


class CourseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    year: int = Field(ge=1, le=8)
    semester: str = Field(min_length=1, max_length=20)
    credits: float = Field(gt=0, le=30)
    examDate: str | None = None
    examType: str = "closed"


class CourseUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    year: int | None = Field(default=None, ge=1, le=8)
    semester: str | None = None
    credits: float | None = Field(default=None, gt=0, le=30)
    examDate: str | None = None
    examType: str | None = None


class CourseOut(BaseModel):
    id: str
    name: str
    year: int
    semester: str
    credits: float
    examDate: str | None = None
    examType: str = "closed"
    finalGrade: float | None = None
    role: str = "owner"


class GradeUpdate(BaseModel):
    finalGrade: float | None = Field(default=None, ge=0, le=100)


class AverageOut(BaseModel):
    label: str
    average: float | None
    totalCredits: float
    gradedCourseCount: int


class GradesOut(BaseModel):
    overall: AverageOut
    perSemester: list[AverageOut]
    courses: list[CourseOut]


class BlockedSlotIn(BaseModel):
    day: int = Field(ge=0, le=6)
    startTime: str
    endTime: str


class ConstraintsIn(BaseModel):
    blockedSlots: list[BlockedSlotIn] = []
    timePreference: str = "evening"


class ConstraintsOut(BaseModel):
    blockedSlots: list[BlockedSlotIn]
    timePreference: str


class AiSettingsIn(BaseModel):
    aiEnabled: bool
    # Omitted means "keep the stored key" - the frontend never holds the real key.
    apiKey: str | None = Field(default=None, min_length=10, max_length=200)


class AiSettingsOut(BaseModel):
    """Deliberately has no apiKey field - the key never leaves the server."""

    aiEnabled: bool
    hasApiKey: bool
    keyHint: str | None = None

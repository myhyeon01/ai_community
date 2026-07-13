class OCRService:
    """Flutter ML Kit 결과를 정규화한다. 원본 이미지는 서버에 보관하지 않는다."""
    def normalize(self, blocks: list[dict]) -> list[dict]:
        required={"name","weekday","start_time","end_time"}
        return [b for b in blocks if required.issubset(b)]


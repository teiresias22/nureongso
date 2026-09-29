from ingest import staff_names

assert staff_names("홍길동, 김철수") == ["홍길동", "김철수"]
assert staff_names("홍길동, 홍길동, 이영희") == ["홍길동", "이영희"]   # 동명이인은 하나로
assert staff_names("") == [] and staff_names(None) == []
print("ok")

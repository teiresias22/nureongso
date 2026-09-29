"""시도마다 모양이 다른 날짜·금액·인원·머리줄을 한 규칙으로 읽는지 본다."""
from expense import header_map, people, when, won

assert when("46237", "0.5").hour == 12                    # 엑셀 일련번호 + 하루 비율(경기)
assert when("2026-08-03", "11:41").minute == 41           # 날짜·시간 칸이 따로(인천)
assert when("2026. 8. 3.").day == 3                       # 대전
assert when("2026-08-01 08:25:25").hour == 8              # 제주
assert when("계") is None                                 # 합계 줄
assert won("1 13,000") == 113000                          # PDF 가 숫자를 쪼갠 것(곡성·세종)
assert won("6 ,600,000") == 6600000
assert people("시장 외 13명") == 14 and people("관련 관계자 등 12명") == 12 and people("") is None
m = header_map(["연번", "건 명", "지출액", "인원/수량", "사용내역", "카드/현금", "사용일자", "업소명"])
assert (m["purpose"], m["amount"], m["headcount"], m["payment"], m["used_at"], m["place"]) == (1, 2, 3, 5, 6, 7)
print("ok")

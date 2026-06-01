import os
import sys
import base64
import json
from pathlib import Path

# Try to import openai, provide clear instructions if missing
try:
    from openai import OpenAI
except ImportError:
    print("오류: 'openai' 라이브러리가 설치되어 있지 않습니다.")
    print("터미널에 다음 명령어를 입력하여 설치해 주세요:")
    print("pip install openai")
    sys.exit(1)

def encode_image(image_path):
    """이미지 파일을 읽어 Base64 문자열로 인코딩합니다."""
    try:
        with open(image_path, "rb") as image_file:
            return base64.b64encode(image_file.read()).decode('utf-8')
    except FileNotFoundError:
        print(f"오류: 파일을 찾을 수 없습니다. 경로를 확인해 주세요: {image_path}")
        sys.exit(1)
    except Exception as e:
        print(f"오류: 이미지를 읽는 중 문제가 발생했습니다: {e}")
        sys.exit(1)

def main():
    print("=" * 60)
    print(" Vision AI 메뉴판 데이터 추출 도구 (GPT-4o)")
    print("=" * 60)

    # 1. API 키 확인
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("[!] OPENAI_API_KEY 환경 변수가 설정되어 있지 않습니다.")
        user_key = input("OpenAI API 키를 입력하세요 (빈칸인 경우 환경변수 탐색): ").strip()
        if user_key:
            os.environ["OPENAI_API_KEY"] = user_key
        else:
            print("오류: API 키가 필요합니다. 환경변수를 설정하거나 키를 직접 입력해 주세요.")
            sys.exit(1)

    # 2. 이미지 파일 경로 입력 받기
    # 테스트용으로 같은 폴더 내의 sample_menu.png를 기본값으로 제안합니다.
    default_path = "./sample_menu.png"
    prompt_text = f"메뉴판 이미지 파일 경로를 입력하세요 (기본값: {default_path}): "
    image_path_input = input(prompt_text).strip()
    
    image_path = image_path_input if image_path_input else default_path
    
    # 절대 경로로 변환
    image_path = Path(image_path).resolve()
    print(f"-> 대상 이미지: {image_path}")

    # 3. 이미지 인코딩
    base64_image = encode_image(image_path)

    # 4. OpenAI 클라이언트 초기화
    client = OpenAI()

    print("\nVision AI가 메뉴판 이미지를 분석하고 있습니다. 잠시만 기다려 주세요...")

    try:
        # GPT-4o 호출 (JSON 모드 사용)
        response = client.chat.completions.create(
            model="gpt-4o",
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": (
                        "너는 이미지에서 메뉴판의 메뉴와 가격을 정확히 추출하는 전문 Vision AI 비서이다. "
                        "다음 규칙을 반드시 지켜서 응답하라:\n\n"
                        "1. 제공된 이미지에서 모든 메뉴 이름과 해당 가격을 추출하라.\n"
                        "2. 가격은 '원', ',', '.', '천원' 등의 단위나 텍스트 기호를 모두 제거하고 오직 순수한 숫자(Integer) 형태로만 정제하라. (예: '7,000원' -> 7000, '7.0' -> 7000)\n"
                        "3. 메뉴명과 가격의 물리적 거리가 멀거나 줄바꿈이 불규칙해도 문맥을 파악하여 정확히 1:1로 매칭하라.\n\n"
                        "응답 형식은 반드시 아래와 같이 'menu_items' 키에 배열이 들어있는 JSON 객체 형식이어야 한다:\n"
                        "{\n"
                        '  "menu_items": [\n'
                        '    { "menu_name": "메뉴이름1", "price": 10000 },\n'
                        '    { "menu_name": "메뉴이름2", "price": 8000 }\n'
                        "  ]\n"
                        "}"
                    )
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "이 이미지 속 메뉴판에서 모든 메뉴 이름과 가격을 추출해서 지정된 JSON 형식으로 변환해줘."
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{base64_image}"
                            }
                        }
                    ]
                }
            ],
            max_tokens=1500,
            temperature=0.0
        )

        # 5. 결과 파싱 및 출력
        raw_content = response.choices[0].message.content
        parsed_data = json.loads(raw_content)
        
        # 'menu_items' 키에서 순수 배열만 추출하여 포맷팅
        menu_list = parsed_data.get("menu_items", parsed_data)
        
        print("\n" + "=" * 25 + " 추출 완료 " + "=" * 25)
        # 요구사항에 맞게 JSON 배열 형태로 예쁘게 출력
        print(json.dumps(menu_list, indent=2, ensure_ascii=False))
        print("=" * 60)

    except Exception as e:
        print(f"\nAPI 호출 중 오류가 발생했습니다: {e}")
        print("API 키 상태와 인터넷 연결을 확인해 주세요.")

if __name__ == "__main__":
    main()

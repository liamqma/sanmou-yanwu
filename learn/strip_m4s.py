import sys

def strip_header(input_file, output_file):
    with open(input_file, 'rb') as f_in:
        content = f_in.read()
        
    # Bilibili client prepends '000000000' (9 bytes) to the m4s files
    if content.startswith(b'000000000'):
        content = content[9:]
        
    with open(output_file, 'wb') as f_out:
        f_out.write(content)
        
    print(f"Processed {input_file} -> {output_file}")

if __name__ == '__main__':
    strip_header(sys.argv[1], sys.argv[2])

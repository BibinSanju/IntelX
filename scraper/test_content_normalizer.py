import unittest

from content_normalizer import html_to_markdown


class ContentNormalizerTests(unittest.TestCase):
    def test_preserves_problem_structure_and_removes_scripts(self):
        value = html_to_markdown("""
            <script>steal()</script>
            <h1>Input</h1>
            <p>Read <code>n</code>.</p>
            <ul><li>1 &lt;= n &lt;= 10</li></ul>
            <h2>Example</h2><pre>3\n1 2 3</pre>
        """)

        self.assertIn("# Input", value)
        self.assertIn("Read `n`.", value)
        self.assertIn("- 1 <= n <= 10", value)
        self.assertIn("```\n3\n1 2 3\n```", value)
        self.assertNotIn("steal", value)


if __name__ == "__main__":
    unittest.main()
